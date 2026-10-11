/**
 * Watch pairing (a device-code flow on top of Cognito custom auth):
 *
 * 1. The watch asks for a pairing: it gets a 6-character code to show and a
 *    secret it keeps. Only the secret's SHA-256 is stored.
 * 2. The signed-in user types the code on the dashboard (or the iPhone app):
 *    the pairing is approved for that user.
 * 3. The watch sees "approved" and signs in to Cognito with CUSTOM_AUTH,
 *    answering the challenge with `<pairingId>.<secret>`. The
 *    VerifyAuthChallenge trigger checks it and consumes the pairing.
 *
 * No password reaches the watch and no long-lived token crosses
 * WatchConnectivity. Codes expire after 10 minutes and work once.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** No 0/O, 1/I/L: easy to read on a watch and type on a laptop. */
export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 6;
export const PAIRING_TTL_SECONDS = 600;

export function newCode(): string {
  const bytes = randomBytes(CODE_LENGTH * 2);
  let code = "";
  for (let i = 0; code.length < CODE_LENGTH && i < bytes.length; i++) {
    // Rejection sampling keeps every character equally likely.
    if (bytes[i] < 248) code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return code.length === CODE_LENGTH ? code : newCode();
}

export function normalizeCode(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const code = input.toUpperCase().replace(/[\s-]/g, "");
  return code.length === CODE_LENGTH && [...code].every((c) => CODE_ALPHABET.includes(c)) ? code : null;
}

export const newSecret = () => randomBytes(32).toString("base64url");
export const hashSecret = (secret: string) => createHash("sha256").update(secret).digest("hex");

export function secretMatches(secret: string, storedHash: string): boolean {
  const a = Buffer.from(hashSecret(secret), "hex");
  const b = Buffer.from(storedHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** `<pairingId>.<secret>` → parts, or null. */
export function parseAnswer(answer: unknown): { pairingId: string; secret: string } | null {
  if (typeof answer !== "string" || answer.length > 300) return null;
  const dot = answer.indexOf(".");
  if (dot <= 0) return null;
  const pairingId = answer.slice(0, dot);
  const secret = answer.slice(dot + 1);
  return /^[A-Za-z0-9-]{8,64}$/.test(pairingId) && /^[A-Za-z0-9_-]{20,100}$/.test(secret) ? { pairingId, secret } : null;
}
