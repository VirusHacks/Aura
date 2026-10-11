import type { ApiError } from "../../../types/api";

export type ErrorCode = NonNullable<ApiError["code"]>;

/** An error with a safe, user-facing message and an HTTP status. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: ErrorCode,
  ) {
    super(message);
  }
}

export const badRequest = (message: string): never => {
  throw new HttpError(400, message, "validation");
};
export const unauthenticated = (message = "Sign in required"): never => {
  throw new HttpError(401, message, "unauthenticated");
};
export const forbidden = (message = "Not allowed"): never => {
  throw new HttpError(403, message, "forbidden");
};
export const notFound = (message = "Not found"): never => {
  throw new HttpError(404, message, "not-found");
};
export const conflict = (message: string): never => {
  throw new HttpError(409, message, "conflict");
};
export const rateLimited = (message = "Too many requests, try again shortly"): never => {
  throw new HttpError(429, message, "rate-limited");
};
export const outsideCoverage = (message: string): never => {
  throw new HttpError(404, message, "outside-coverage");
};

/** DynamoDB conditional-write failure (lost race or duplicate). */
export function isConditionalFailure(err: unknown): boolean {
  return (err as { name?: string })?.name === "ConditionalCheckFailedException";
}
