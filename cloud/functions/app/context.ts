/**
 * Dependencies of the API services. Each Lambda builds a context with only the
 * repositories its IAM role can reach; tests and the dev server use memory ones.
 */
import { randomUUID } from "node:crypto";
import { DEMO_DATASET } from "../../../data/demo-zones";
import type { RoutingProviderId, Scenario } from "../../../types/api";
import type { ZoneDataset } from "../../../types/air-quality";
import { type City, buildCity, scenarioForClock, DEFAULT_PRESET } from "../domain/city";
import type { RoutingProvider } from "../domain/routing/types";
import type { AlertsRepo, CityRepo, IdempotencyRepo, PairingRepo, TripsRepo, UsersRepo } from "../repo/types";
import { HttpError } from "../shared/errors";
import { type Logger, log } from "../shared/log";
import type { EventPublisher } from "../services/events";
import type { PushSender } from "../services/push";

export interface AppConfig {
  stage: string;
  region: string;
  version: string;
  /** Zone transitions and the last coarse position are kept this long. */
  locationRetentionDays: number;
  alertRetentionDays: number;
  routing: RoutingProviderId;
  push: { sandboxArn: string | null; productionArn: string | null };
  cognito: { userPoolId: string; webClientId: string; iosClientId: string; watchClientId: string } | null;
  realtime: { httpDomain: string; realtimeDomain: string; namespace: string } | null;
  webUrl: string | null;
  /** Dashboard scenario snapshots older than this are ignored in favour of the clock. */
  scenarioMaxAgeHours: number;
  /** Local dev server only: accepts `Bearer dev.<userId>` tokens. Never set in AWS. */
  devMode: boolean;
}

export interface AppContext {
  config: AppConfig;
  city: CityRepo;
  trips?: TripsRepo;
  alerts?: AlertsRepo;
  users?: UsersRepo;
  idempotency?: IdempotencyRepo;
  pairing?: PairingRepo;
  events: EventPublisher;
  routing: (city: City, aqiByZone: Map<string, number>) => RoutingProvider;
  /** Demo provider used when the configured provider fails. */
  fallbackRouting: (city: City, aqiByZone: Map<string, number>) => RoutingProvider;
  push?: PushSender;
  clock: () => Date;
  newId: () => string;
  log: Logger;
}

const str = (v: string | undefined) => (v && v.trim() ? v.trim() : null);

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const pool = str(env.COGNITO_USER_POOL_ID);
  const http = str(env.APPSYNC_HTTP_DOMAIN);
  return {
    stage: env.STAGE ?? "dev",
    region: env.AWS_REGION ?? "us-east-1",
    version: env.APP_VERSION ?? "1.0.0",
    locationRetentionDays: Number(env.LOCATION_RETENTION_DAYS ?? 30),
    alertRetentionDays: Number(env.ALERT_RETENTION_DAYS ?? 30),
    routing: env.ROUTING_PROVIDER === "amazon-location" ? "amazon-location" : "demo-zone-graph",
    push: { sandboxArn: str(env.APNS_PLATFORM_ARN_SANDBOX), productionArn: str(env.APNS_PLATFORM_ARN_PRODUCTION) },
    cognito: pool
      ? {
          userPoolId: pool,
          webClientId: env.COGNITO_WEB_CLIENT_ID ?? "",
          iosClientId: env.COGNITO_IOS_CLIENT_ID ?? "",
          watchClientId: env.COGNITO_WATCH_CLIENT_ID ?? "",
        }
      : null,
    realtime: http ? { httpDomain: http, realtimeDomain: env.APPSYNC_REALTIME_DOMAIN ?? "", namespace: env.APPSYNC_NAMESPACE ?? "aeroscope" } : null,
    webUrl: str(env.WEB_URL),
    scenarioMaxAgeHours: Number(env.SCENARIO_MAX_AGE_HOURS ?? 12),
    devMode: env.AEROSCOPE_DEV_MODE === "1",
  };
}

export function need<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new HttpError(500, `Service misconfigured (${what})`);
  return value;
}

export const defaultIds = { clock: () => new Date(), newId: () => randomUUID(), log };

// ---------------------------------------------------------------- City & scenario

let cityCache: { dataset: ZoneDataset; city: City } | null = null;

export async function loadCity(ctx: AppContext): Promise<City> {
  let dataset: ZoneDataset | null = null;
  try {
    dataset = await ctx.city.loadDataset();
  } catch (err) {
    ctx.log.warn("Zone table unavailable; using the bundled demo dataset", { error: (err as Error).name });
  }
  const chosen = dataset ?? DEMO_DATASET;
  if (cityCache?.dataset !== chosen) cityCache = { dataset: chosen, city: buildCity(chosen) };
  return cityCache.city;
}

/** The dashboard's latest saved scenario (if recent), else the Delhi clock with Urban Traffic Haze. */
export async function activeScenario(ctx: AppContext, now: Date): Promise<Scenario> {
  try {
    const saved = await ctx.city.latestScenario();
    if (saved && now.getTime() - Date.parse(saved.savedAt) < ctx.config.scenarioMaxAgeHours * 3_600_000) return saved.scenario;
  } catch (err) {
    ctx.log.warn("Scenario table unavailable; using the clock", { error: (err as Error).name });
  }
  return scenarioForClock(DEFAULT_PRESET, now);
}
