/**
 * Transport-neutral HTTP handling: the Lambda adapter (API Gateway HTTP API,
 * payload v2 with a Cognito JWT authorizer) and the dev server both turn
 * requests into `ApiRequest` and dispatch them through the same routes.
 */
import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from "aws-lambda";
import { HttpError } from "../shared/errors";
import { metric } from "../shared/log";
import { MAX_BODY_BYTES } from "../shared/validation";
import type { AppContext } from "./context";

export interface AuthUser {
  /** Cognito `sub`: the stable owner id for every record. */
  userId: string;
  /** Cognito username (for pairing sign-in). */
  username: string;
  email?: string;
  clientId?: string;
}

export interface ApiRequest {
  method: string;
  path: string;
  params: Record<string, string>;
  query: Record<string, string>;
  headers: Record<string, string>;
  body: unknown;
  user: AuthUser | null;
  correlationId: string;
  sourceIp?: string;
}

export interface ApiResponse {
  status: number;
  body: unknown;
}

export interface Route {
  method: string;
  /** Path with `{name}` parameters, e.g. /v1/trips/{tripId}. */
  path: string;
  auth: boolean;
  /** Replays the stored response for a repeated `Idempotency-Key`. */
  idempotent?: boolean;
  handler: (req: ApiRequest & { user: AuthUser }, ctx: AppContext) => Promise<ApiResponse>;
}

interface CompiledRoute extends Route {
  regex: RegExp;
}

const CORRELATION = /^[A-Za-z0-9._:-]{8,128}$/;
const IDEMPOTENCY = /^[A-Za-z0-9._:-]{1,128}$/;
const IDEMPOTENCY_TTL_SECONDS = 7 * 86_400;

export function compile(routes: Route[]): CompiledRoute[] {
  return routes.map((r) => ({
    ...r,
    regex: new RegExp(`^${r.path.replace(/\{(\w+)\}/g, (_m, name: string) => `(?<${name}>[^/]+)`)}$`),
  }));
}

export async function dispatch(routes: CompiledRoute[], req: ApiRequest, ctx: AppContext): Promise<ApiResponse> {
  const log = ctx.log.child({ correlationId: req.correlationId, method: req.method, path: req.path.replace(/[0-9a-f-]{20,}/gi, ":id") });
  const started = Date.now();
  let routeName = "unmatched";
  try {
    let methodMismatch = false;
    for (const r of routes) {
      const m = r.regex.exec(req.path);
      if (!m) continue;
      if (r.method !== req.method) {
        methodMismatch = true;
        continue;
      }
      routeName = `${r.method} ${r.path}`;
      const params = Object.fromEntries(Object.entries(m.groups ?? {}).map(([k, v]) => [k, decodeURIComponent(v)]));
      if (r.auth && !req.user) throw new HttpError(401, "Sign in required", "unauthenticated");
      const key = req.headers["idempotency-key"];
      if (r.idempotent && key !== undefined) {
        if (!IDEMPOTENCY.test(key)) throw new HttpError(400, "Invalid Idempotency-Key", "validation");
        const stored = await ctx.idempotency?.get(req.user?.userId ?? "anonymous", key);
        if (stored) {
          metric("IdempotentReplays");
          return { status: stored.status, body: { ...(stored.body as object), replayed: true } };
        }
      }
      const response = await r.handler({ ...req, params, user: req.user as AuthUser }, { ...ctx, log });
      if (r.idempotent && key !== undefined && response.status < 500) {
        await ctx.idempotency?.put(req.user?.userId ?? "anonymous", key, response, IDEMPOTENCY_TTL_SECONDS);
      }
      return response;
    }
    return methodMismatch ? { status: 405, body: { error: "Method not allowed" } } : { status: 404, body: { error: "Not found", code: "not-found" } };
  } catch (err) {
    if (err instanceof HttpError) {
      if (err.status >= 500) log.error("Request failed", { route: routeName, status: err.status, error: err.message });
      return { status: err.status, body: { error: err.message, ...(err.code ? { code: err.code } : {}), correlationId: req.correlationId } };
    }
    log.error("Unhandled error", { route: routeName, error: (err as Error).name, message: (err as Error).message });
    metric("ApiErrors", 1, { Route: routeName });
    return { status: 500, body: { error: "Internal error", correlationId: req.correlationId } };
  } finally {
    metric("ApiLatency", Date.now() - started, { Route: routeName }, "Milliseconds");
  }
}

function parseBody(raw: string | undefined, isBase64: boolean | undefined): unknown {
  if (!raw) return undefined;
  const text = isBase64 ? Buffer.from(raw, "base64").toString("utf8") : raw;
  if (Buffer.byteLength(text) > MAX_BODY_BYTES) throw new HttpError(413, "Request body too large", "validation");
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "Body must be JSON", "validation");
  }
}

/** Builds the Lambda handler for a set of routes. Identity comes only from the verified JWT. */
export function lambdaHandler(routes: Route[], makeContext: () => AppContext) {
  const compiled = compile(routes);
  let ctx: AppContext | null = null;
  return async (event: APIGatewayProxyEventV2WithJWTAuthorizer): Promise<APIGatewayProxyResultV2> => {
    ctx ??= makeContext();
    const headers = Object.fromEntries(Object.entries(event.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v ?? ""]));
    const supplied = headers["x-correlation-id"];
    const correlationId = supplied && CORRELATION.test(supplied) ? supplied : event.requestContext.requestId;
    let response: ApiResponse;
    try {
      const claims = event.requestContext.authorizer?.jwt?.claims;
      const sub = typeof claims?.sub === "string" ? claims.sub : null;
      const user: AuthUser | null = sub
        ? {
            userId: sub,
            username: String(claims?.username ?? claims?.["cognito:username"] ?? sub),
            email: typeof claims?.email === "string" ? claims.email : undefined,
            clientId: typeof claims?.client_id === "string" ? claims.client_id : undefined,
          }
        : null;
      response = await dispatch(
        compiled,
        {
          method: event.requestContext.http.method.toUpperCase(),
          path: event.rawPath.replace(/\/+$/, "") || "/",
          params: {},
          query: (event.queryStringParameters ?? {}) as Record<string, string>,
          headers,
          body: parseBody(event.body, event.isBase64Encoded),
          user,
          correlationId,
          sourceIp: event.requestContext.http.sourceIp,
        },
        ctx,
      );
    } catch (err) {
      const e = err instanceof HttpError ? err : new HttpError(500, "Internal error");
      response = { status: e.status, body: { error: e.message, ...(e.code ? { code: e.code } : {}), correlationId } };
    }
    return {
      statusCode: response.status,
      headers: { "content-type": "application/json", "x-correlation-id": correlationId, "cache-control": "no-store" },
      body: JSON.stringify(response.body ?? {}),
    };
  };
}

export const ok = (body: unknown, status = 200): ApiResponse => ({ status, body });
