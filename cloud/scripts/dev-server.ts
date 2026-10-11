/**
 * Local AEROSCOPE API: the same routes and services as the Lambdas, with
 * in-memory storage. For the web dashboard (`AEROSCOPE_API_URL=http://localhost:8787`)
 * and the watch/iPhone simulators.
 *
 * Differences from AWS, local only:
 * - identity is `Authorization: Bearer dev.<userId>` (get one from POST /dev/sign-in);
 * - real-time events stream as Server-Sent Events from GET /v1/dev/stream?token=…;
 * - an approved watch pairing returns a `devToken` instead of a Cognito sign-in.
 *
 *   npm run dev            # http://localhost:8787
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { alertRoutes } from "../functions/app/alerts";
import { type AppContext, configFromEnv, defaultIds } from "../functions/app/context";
import { type ApiRequest, compile, dispatch } from "../functions/app/http";
import { publicRoutes } from "../functions/app/public";
import { routeRoutes } from "../functions/app/routes";
import { settingsRoutes } from "../functions/app/settings";
import { tripRoutes } from "../functions/app/trips";
import { normalizeScenario } from "../functions/domain/city";
import { ZoneGraphRoutingProvider } from "../functions/domain/routing/zone-graph";
import {
  MemoryAlertsRepo,
  MemoryCityRepo,
  MemoryIdempotencyRepo,
  MemoryPairingRepo,
  MemoryTripsRepo,
  MemoryUsersRepo,
} from "../functions/repo/memory";
import { type DomainEvent, MemoryEventPublisher } from "../functions/services/events";

process.env.METRICS_DISABLED = "1";
process.env.AEROSCOPE_DEV_MODE = "1";
const PORT = Number(process.env.PORT ?? 8787);
const DEV_TOKEN = /^dev\.([A-Za-z0-9-]{1,50})$/;

const streams = new Map<string, Set<ServerResponse>>();
const forward = (e: DomainEvent) => {
  for (const res of streams.get(e.detail.userId) ?? []) res.write(`data: ${JSON.stringify(e.detail.envelope)}\n\n`);
};

const ctx: AppContext = {
  config: { ...configFromEnv(), devMode: true, realtime: null, webUrl: process.env.WEB_URL ?? "http://localhost:3000" },
  city: new MemoryCityRepo(),
  trips: new MemoryTripsRepo(),
  alerts: new MemoryAlertsRepo(),
  users: new MemoryUsersRepo(),
  idempotency: new MemoryIdempotencyRepo(),
  pairing: new MemoryPairingRepo(),
  events: new MemoryEventPublisher(forward),
  routing: (city, aqi) => new ZoneGraphRoutingProvider(city, aqi),
  fallbackRouting: (city, aqi) => new ZoneGraphRoutingProvider(city, aqi),
  ...defaultIds,
};
const routes = compile([...publicRoutes, ...tripRoutes, ...alertRoutes, ...routeRoutes, ...settingsRoutes]);

function userFrom(token: string | undefined) {
  const m = token ? DEV_TOKEN.exec(token.replace(/^Bearer\s+/i, "")) : null;
  return m ? { userId: m[1], username: m[1], email: `${m[1]}@local.dev` } : null;
}

function cors(res: ServerResponse) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", "authorization, content-type, idempotency-key, x-correlation-id, x-aeroscope-client, x-pairing-secret");
  res.setHeader("access-control-allow-methods", "GET, POST, PUT, OPTIONS");
  res.setHeader("access-control-expose-headers", "x-correlation-id");
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (!chunks.length) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return "__invalid__";
  }
}

const send = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

createServer(async (req, res) => {
  cors(res);
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  if (req.method === "OPTIONS") return void res.writeHead(204).end();

  if (req.method === "POST" && url.pathname === "/dev/sign-in") {
    const body = (await readBody(req)) as { email?: string } | undefined;
    const slug = (body?.email ?? "demo").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "demo";
    return send(res, 200, { token: `dev.${slug}`, userId: slug, email: body?.email ?? `${slug}@local.dev`, expiresIn: 86_400 });
  }

  // Stands in for the /infra scenario table locally: the dashboard's scenario drives readings.
  if (req.method === "POST" && url.pathname === "/dev/scenario") {
    const body = (await readBody(req)) as { preset?: string; timeIndex?: number } | undefined;
    (ctx.city as MemoryCityRepo).scenario = { scenario: normalizeScenario((body ?? {}) as Parameters<typeof normalizeScenario>[0]), savedAt: new Date().toISOString() };
    return send(res, 200, (ctx.city as MemoryCityRepo).scenario);
  }

  if (req.method === "GET" && url.pathname === "/v1/dev/stream") {
    const user = userFrom(url.searchParams.get("token") ?? undefined);
    if (!user) return send(res, 401, { error: "token required" });
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    res.write(": connected\n\n");
    const set = streams.get(user.userId) ?? new Set();
    set.add(res);
    streams.set(user.userId, set);
    const ka = setInterval(() => res.write(": ka\n\n"), 25_000);
    req.on("close", () => {
      clearInterval(ka);
      set.delete(res);
    });
    return;
  }

  const body = await readBody(req);
  const correlationId = (req.headers["x-correlation-id"] as string) ?? randomUUID();
  const apiReq: ApiRequest = {
    method: (req.method ?? "GET").toUpperCase(),
    path: url.pathname.replace(/\/+$/, "") || "/",
    params: {},
    query: Object.fromEntries(url.searchParams),
    headers: Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(",") : (v ?? "")])),
    body: body === "__invalid__" ? undefined : body,
    user: userFrom(req.headers.authorization),
    correlationId,
  };
  if (body === "__invalid__") return send(res, 400, { error: "Body must be JSON", code: "validation" });
  const out = await dispatch(routes, apiReq, ctx);
  res.setHeader("x-correlation-id", correlationId);
  send(res, out.status, out.body);
}).listen(PORT, () => {
  console.log(`AEROSCOPE dev API on http://localhost:${PORT} (in-memory; dev tokens; SSE at /v1/dev/stream)`);
});
