/**
 * Browser client for the AEROSCOPE API. Holds short-lived tokens in memory only
 * (the refresh token stays in an httpOnly cookie handled by /api/auth/*).
 */
import type { ClientConfig } from "@/types/api";

export interface LiveConfig {
  mode: "aws" | "dev" | "off";
  apiUrl: string | null;
  region: string | null;
  realtime: ClientConfig["realtime"];
  routing: ClientConfig["routing"] | null;
  push: boolean;
}

export interface Session {
  accessToken: string;
  idToken: string;
  expiresAt: number;
  email: string | null;
  sub: string | null;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
    readonly correlationId?: string,
  ) {
    super(message);
  }
}

function decodeClaims(token: string): Record<string, unknown> {
  if (token.startsWith("dev.")) return { sub: token.slice(4), email: `${token.slice(4)}@local.dev` };
  try {
    const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(part.padEnd(part.length + ((4 - (part.length % 4)) % 4), "=")));
  } catch {
    return {};
  }
}

export function toSession(t: { accessToken: string; idToken: string; expiresIn: number }): Session {
  const claims = decodeClaims(t.idToken);
  return {
    accessToken: t.accessToken,
    idToken: t.idToken,
    expiresAt: Date.now() + t.expiresIn * 1000,
    email: typeof claims.email === "string" ? claims.email : null,
    sub: typeof claims.sub === "string" ? claims.sub : null,
  };
}

async function authCall(action: string, body?: unknown): Promise<Response> {
  return fetch(`/api/auth/${action}`, {
    method: "POST",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
    cache: "no-store",
  });
}

async function json<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as T & { error?: string; code?: string; correlationId?: string };
  if (!res.ok) throw new ApiError(res.status, body.error ?? `HTTP ${res.status}`, body.code, body.correlationId);
  return body;
}

export const auth = {
  async signIn(email: string, password: string) {
    return toSession(await json(await authCall("sign-in", { email, password })));
  },
  async signUp(email: string, password: string) {
    return json<{ confirmationRequired?: boolean }>(await authCall("sign-up", { email, password }));
  },
  async confirm(email: string, code: string) {
    return json<{ confirmed: boolean }>(await authCall("confirm", { email, code }));
  },
  async resend(email: string) {
    return json<{ sent: boolean }>(await authCall("resend", { email }));
  },
  async refresh(): Promise<Session | null> {
    const res = await authCall("refresh");
    if (res.status === 401 || res.status === 503) return null;
    return toSession(await json(res));
  },
  async signOut() {
    await authCall("sign-out").catch(() => undefined);
  },
};

export async function loadConfig(): Promise<LiveConfig> {
  const res = await fetch("/api/live/config", { cache: "no-store" });
  return json<LiveConfig>(res);
}

const uuid = () => (typeof globalThis.crypto?.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

/** Calls the API with the current access token, refreshing it once on 401. */
export class LiveApi {
  constructor(
    private readonly baseUrl: string,
    private readonly getSession: () => Session | null,
    private readonly refresh: () => Promise<Session | null>,
  ) {}

  async request<T>(method: string, path: string, body?: unknown, opts: { idempotent?: boolean; auth?: boolean } = {}): Promise<T> {
    const send = async (session: Session | null) => {
      const headers: Record<string, string> = { accept: "application/json", "x-aeroscope-client": "web", "x-correlation-id": `web-${uuid()}` };
      if (body !== undefined) headers["content-type"] = "application/json";
      if (opts.auth !== false && session) headers.authorization = `Bearer ${session.accessToken}`;
      if (opts.idempotent) headers["idempotency-key"] = uuid();
      return fetch(`${this.baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store" });
    };
    let session = this.getSession();
    if (opts.auth !== false && session && session.expiresAt - Date.now() < 60_000) session = await this.refresh();
    let res = await send(session);
    if (res.status === 401 && opts.auth !== false) {
      session = await this.refresh();
      if (session) res = await send(session);
    }
    return json<T>(res);
  }

  get<T>(path: string, opts?: { auth?: boolean }) {
    return this.request<T>("GET", path, undefined, opts);
  }
  post<T>(path: string, body: unknown, idempotent = true) {
    return this.request<T>("POST", path, body, { idempotent });
  }
  put<T>(path: string, body: unknown) {
    return this.request<T>("PUT", path, body, { idempotent: true });
  }
}

export const newId = uuid;
