/**
 * Server-only helpers for the live (watch-linked) mode: the backend's public
 * client configuration and Cognito calls made from Route Handlers, so the
 * refresh token never reaches page JavaScript.
 *
 * Environment: AEROSCOPE_API_URL — the AEROSCOPE HTTP API (cloud stack output
 * `ApiUrl`) or the local dev server (http://localhost:8787). Everything else
 * (Cognito ids, real-time endpoints) is read from GET /v1/client-config.
 */
import type { ClientConfig } from "@/types/api";

export type LiveMode = "aws" | "dev" | "off";

export interface LiveServerConfig {
  mode: LiveMode;
  apiUrl: string | null;
  client: ClientConfig | null;
}

let cached: { at: number; value: LiveServerConfig } | null = null;
const TTL_MS = 5 * 60_000;

export async function liveConfig(): Promise<LiveServerConfig> {
  const apiUrl = process.env.AEROSCOPE_API_URL?.trim().replace(/\/$/, "") || null;
  if (!apiUrl) return { mode: "off", apiUrl: null, client: null };
  if (cached && Date.now() - cached.at < TTL_MS && cached.value.apiUrl === apiUrl) return cached.value;
  try {
    const res = await fetch(`${apiUrl}/v1/client-config`, { cache: "no-store", signal: AbortSignal.timeout(4000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const client = (await res.json()) as ClientConfig;
    const value: LiveServerConfig = { mode: client.cognito?.userPoolId ? "aws" : "dev", apiUrl, client };
    cached = { at: Date.now(), value };
    return value;
  } catch {
    // Don't cache failures: the next request tries again.
    return { mode: "off", apiUrl, client: null };
  }
}

export class CognitoError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

const FRIENDLY: Record<string, string> = {
  NotAuthorizedException: "Incorrect email or password.",
  UserNotFoundException: "Incorrect email or password.",
  UserNotConfirmedException: "Confirm your email first — enter the code we sent you.",
  UsernameExistsException: "An account with this email already exists. Sign in instead.",
  CodeMismatchException: "That code is not right. Check the email and try again.",
  ExpiredCodeException: "That code has expired. Request a new one.",
  InvalidPasswordException: "Password needs at least 10 characters with upper- and lower-case letters and a digit.",
  LimitExceededException: "Too many attempts. Wait a minute and try again.",
  TooManyRequestsException: "Too many attempts. Wait a minute and try again.",
  InvalidParameterException: "Check the email and password format.",
};

/** One unsigned call to the Cognito user pools API (public app client, no secret). */
export async function cognito<T>(region: string, target: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`https://cognito-idp.${region}.amazonaws.com/`, {
    method: "POST",
    headers: { "content-type": "application/x-amz-json-1.1", "x-amz-target": `AWSCognitoIdentityProviderService.${target}` },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const code = String(json.__type ?? "Error").split("#").pop() ?? "Error";
    throw new CognitoError(code, FRIENDLY[code] ?? "Sign-in service error. Try again.", res.status >= 500 ? 502 : 400);
  }
  return json as T;
}

export interface CognitoTokens {
  AccessToken: string;
  IdToken: string;
  RefreshToken?: string;
  ExpiresIn: number;
}
