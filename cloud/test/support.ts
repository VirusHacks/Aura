import { randomUUID } from "node:crypto";
import type { AppConfig, AppContext } from "../functions/app/context";
import { compile, dispatch, type ApiRequest, type AuthUser } from "../functions/app/http";
import { publicRoutes } from "../functions/app/public";
import { tripRoutes } from "../functions/app/trips";
import { alertRoutes } from "../functions/app/alerts";
import { routeRoutes } from "../functions/app/routes";
import { settingsRoutes } from "../functions/app/settings";
import { ZoneGraphRoutingProvider } from "../functions/domain/routing/zone-graph";
import type { RoutingProvider } from "../functions/domain/routing/types";
import {
  MemoryAlertsRepo,
  MemoryCityRepo,
  MemoryIdempotencyRepo,
  MemoryPairingRepo,
  MemoryTripsRepo,
  MemoryUsersRepo,
} from "../functions/repo/memory";
import { MemoryEventPublisher } from "../functions/services/events";
import { createLogger } from "../functions/shared/log";

process.env.METRICS_DISABLED = "1";
process.env.LOG_LEVEL = "error";

export const ALL_ROUTES = compile([...publicRoutes, ...tripRoutes, ...alertRoutes, ...routeRoutes, ...settingsRoutes]);

export const testConfig: AppConfig = {
  stage: "test",
  region: "us-east-1",
  version: "test",
  locationRetentionDays: 30,
  alertRetentionDays: 30,
  routing: "demo-zone-graph",
  push: { sandboxArn: null, productionArn: null },
  cognito: { userPoolId: "pool", webClientId: "web", iosClientId: "ios", watchClientId: "watch" },
  realtime: { httpDomain: "x.appsync-api.us-east-1.amazonaws.com", realtimeDomain: "x.appsync-realtime-api.us-east-1.amazonaws.com", namespace: "aeroscope" },
  webUrl: "https://example.cloudfront.net",
  scenarioMaxAgeHours: 12,
  devMode: false,
};

/** 2026-11-14 09:30 UTC = 15:00 IST → "Urban Traffic Haze · 15:00" when no scenario is saved. */
export const T0 = new Date("2026-11-14T09:30:00.000Z");

export function makeWorld(options: { routing?: (city: never, aqi: never) => RoutingProvider } = {}) {
  let now = T0.getTime();
  const trips = new MemoryTripsRepo();
  const alerts = new MemoryAlertsRepo();
  const users = new MemoryUsersRepo();
  const idempotency = new MemoryIdempotencyRepo();
  const pairing = new MemoryPairingRepo();
  const events = new MemoryEventPublisher();
  const city = new MemoryCityRepo();
  const ctx: AppContext = {
    config: { ...testConfig },
    city,
    trips,
    alerts,
    users,
    idempotency,
    pairing,
    events,
    routing: (options.routing as AppContext["routing"]) ?? ((c, aqi) => new ZoneGraphRoutingProvider(c, aqi)),
    fallbackRouting: (c, aqi) => new ZoneGraphRoutingProvider(c, aqi),
    clock: () => new Date(now),
    newId: () => randomUUID(),
    log: createLogger({ test: true }),
  };
  const user = (id: string): AuthUser => ({ userId: id, username: id, email: `${id}@example.com` });
  async function call(method: string, path: string, opts: { user?: AuthUser | null; body?: unknown; headers?: Record<string, string> } = {}) {
    const [p, q] = path.split("?");
    const req: ApiRequest = {
      method,
      path: p,
      params: {},
      query: Object.fromEntries(new URLSearchParams(q ?? "")),
      headers: Object.fromEntries(Object.entries(opts.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v])),
      body: opts.body,
      user: opts.user === undefined ? user("alice") : opts.user,
      correlationId: `test-${randomUUID()}`,
    };
    return dispatch(ALL_ROUTES, req, ctx);
  }
  return {
    ctx,
    trips,
    alerts,
    users,
    idempotency,
    pairing,
    events,
    city,
    user,
    call,
    advance: (seconds: number) => {
      now += seconds * 1000;
    },
    now: () => new Date(now),
  };
}

export const iso = (d: Date) => d.toISOString();
