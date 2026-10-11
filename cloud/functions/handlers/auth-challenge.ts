/**
 * Cognito custom-auth triggers for watch pairing (see domain/pairing.ts).
 * Only the watch app client may use CUSTOM_AUTH; the web and iPhone clients
 * sign in with a password.
 */
import type {
  CreateAuthChallengeTriggerEvent,
  DefineAuthChallengeTriggerEvent,
  VerifyAuthChallengeResponseTriggerEvent,
} from "aws-lambda";
import { parseAnswer, secretMatches } from "../domain/pairing";
import { DynamoPairingRepo } from "../repo/dynamo";
import type { PairingRepo } from "../repo/types";
import { log, metric } from "../shared/log";

const MAX_ATTEMPTS = 3;

export async function defineAuthChallenge(event: DefineAuthChallengeTriggerEvent): Promise<DefineAuthChallengeTriggerEvent> {
  const session = event.request.session ?? [];
  const last = session.at(-1);
  if (event.request.userNotFound || session.some((s) => s.challengeName !== "CUSTOM_CHALLENGE")) {
    event.response.issueTokens = false;
    event.response.failAuthentication = true;
  } else if (last?.challengeResult === true) {
    event.response.issueTokens = true;
    event.response.failAuthentication = false;
  } else if (session.length >= MAX_ATTEMPTS) {
    event.response.issueTokens = false;
    event.response.failAuthentication = true;
  } else {
    event.response.challengeName = "CUSTOM_CHALLENGE";
    event.response.issueTokens = false;
    event.response.failAuthentication = false;
  }
  return event;
}

export async function createAuthChallenge(event: CreateAuthChallengeTriggerEvent): Promise<CreateAuthChallengeTriggerEvent> {
  // The answer is checked against the pairing table, not a value stored here.
  event.response.publicChallengeParameters = { type: "watch-pairing" };
  event.response.privateChallengeParameters = { type: "watch-pairing" };
  event.response.challengeMetadata = "WATCH_PAIRING";
  return event;
}

export function makeVerifier(repo: PairingRepo, now: () => Date = () => new Date()) {
  return async (event: VerifyAuthChallengeResponseTriggerEvent): Promise<VerifyAuthChallengeResponseTriggerEvent> => {
    event.response.answerCorrect = false;
    const answer = parseAnswer(event.request.challengeAnswer);
    if (!answer) return event;
    const record = await repo.get(answer.pairingId);
    const nowEpoch = Math.floor(now().getTime() / 1000);
    const valid =
      record !== null &&
      record.status === "approved" &&
      record.expiresAt > nowEpoch &&
      record.username === event.userName &&
      secretMatches(answer.secret, record.secretHash);
    // One sign-in per pairing: the conditional consume loses any replay race.
    event.response.answerCorrect = valid && (await repo.consume(answer.pairingId, nowEpoch));
    metric("PairingSignIns", 1, { Outcome: event.response.answerCorrect ? "ok" : "rejected" });
    if (!event.response.answerCorrect) log.warn("Watch pairing sign-in rejected", { reason: record ? record.status : "unknown-pairing" });
    return event;
  };
}

let verifier: ReturnType<typeof makeVerifier> | null = null;
export async function verifyAuthChallenge(event: VerifyAuthChallengeResponseTriggerEvent) {
  verifier ??= makeVerifier(new DynamoPairingRepo(process.env.PAIRING_TABLE!));
  return verifier(event);
}
