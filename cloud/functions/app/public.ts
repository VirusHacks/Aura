/**
 * Public, read-only routes (no sign-in; API Gateway throttles them): health,
 * client configuration, city data, zone readings and the watch side of pairing.
 * Nothing here reads or writes user data.
 */
import { ZONE_LINKS } from "../../../data/delhi-geo";
import type {
  AirQualityZonesResponse,
  ClientConfig,
  CurrentReadingResponse,
  HealthResponse,
  PairingStartResponse,
  PairingStatusResponse,
} from "../../../types/api";
import { airQualityZone, withLabel, zoneReading } from "../domain/city";
import { resolveLocation } from "../domain/evaluate";
import { PAIRING_TTL_SECONDS, hashSecret, newCode, newSecret, secretMatches } from "../domain/pairing";
import { badRequest, notFound } from "../shared/errors";
import { metric } from "../shared/log";
import * as v from "../shared/validation";
import { type AppContext, activeScenario, loadCity, need } from "./context";
import { type ApiRequest, type Route, ok } from "./http";

async function health(_req: ApiRequest, ctx: AppContext) {
  const now = ctx.clock();
  const city = await loadCity(ctx);
  const body: HealthResponse = {
    status: "ok",
    version: ctx.config.version,
    stage: ctx.config.stage,
    provenance: city.dataset.provenance,
    scenario: withLabel(await activeScenario(ctx, now)),
    push: Boolean(ctx.config.push.sandboxArn || ctx.config.push.productionArn),
    realtime: Boolean(ctx.config.realtime),
    routing: ctx.config.routing,
  };
  return ok(body);
}

/** Everything a client needs to sign in and subscribe. Identifiers only — no secrets. */
async function clientConfig(_req: ApiRequest, ctx: AppContext) {
  const c = ctx.config;
  const body: ClientConfig = {
    apiVersion: "v1",
    stage: c.stage,
    region: c.region,
    cognito: c.cognito ?? { userPoolId: "", webClientId: "", iosClientId: "", watchClientId: "" },
    realtime: c.realtime,
    routing: c.routing,
    push: Boolean(c.push.sandboxArn || c.push.productionArn),
    webUrl: c.webUrl,
  };
  return ok(body);
}

async function city(_req: ApiRequest, ctx: AppContext) {
  const now = ctx.clock();
  const c = await loadCity(ctx);
  return ok({
    dataset: { ...c.dataset, links: ZONE_LINKS },
    scenario: withLabel(await activeScenario(ctx, now)),
    generatedAt: now.toISOString(),
  });
}

async function zones(_req: ApiRequest, ctx: AppContext) {
  const now = ctx.clock();
  const c = await loadCity(ctx);
  const scenario = await activeScenario(ctx, now);
  const body: AirQualityZonesResponse = {
    zones: c.dataset.zones.map((z) => airQualityZone(z, scenario, c.dataset.provenance, now.toISOString())),
    scenario: withLabel(scenario),
    sourceLabel: c.dataset.sourceLabel,
    generatedAt: now.toISOString(),
  };
  return ok(body);
}

async function zone(req: ApiRequest, ctx: AppContext) {
  const now = ctx.clock();
  const c = await loadCity(ctx);
  const z = c.byId.get(v.id(req.params.zoneId, "zoneId")) ?? notFound("Unknown zone");
  const scenario = await activeScenario(ctx, now);
  return ok({ zone: airQualityZone(z, scenario, c.dataset.provenance, now.toISOString()), scenario: withLabel(scenario) });
}

/** Reading at a GPS fix (`lat`,`lon`) or zone (`zoneId`). Spec "nearby" maps here. */
async function current(req: ApiRequest, ctx: AppContext) {
  const now = ctx.clock();
  const c = await loadCity(ctx);
  const lat = Number(req.query.lat);
  const lon = Number(req.query.lon);
  const hasGeo = req.query.lat !== undefined && Number.isFinite(lat) && Number.isFinite(lon);
  const zoneId = v.isId(req.query.zoneId) ? req.query.zoneId : null;
  if (!hasGeo && !zoneId) badRequest("Pass lat and lon, or zoneId");
  const match = resolveLocation(c, { geo: hasGeo ? { lat, lon } : null, zoneId, simulated: !hasGeo });
  const scenario = await activeScenario(ctx, now);
  const body: CurrentReadingResponse = {
    reading: zoneReading(c.byId.get(match.zoneId)!, scenario, c.dataset.provenance),
    match,
    scenario: withLabel(scenario),
    generatedAt: now.toISOString(),
  };
  return ok(body);
}

async function scenario(_req: ApiRequest, ctx: AppContext) {
  return ok(withLabel(await activeScenario(ctx, ctx.clock())));
}

// ---------------------------------------------------------------- Pairing (watch side)

async function startPairing(_req: ApiRequest, ctx: AppContext) {
  const pairing = need(ctx.pairing, "pairing");
  const now = ctx.clock();
  const secret = newSecret();
  for (let attempt = 0; attempt < 5; attempt++) {
    const record = {
      pairingId: ctx.newId(),
      code: newCode(),
      secretHash: hashSecret(secret),
      status: "pending" as const,
      expiresAt: Math.floor(now.getTime() / 1000) + PAIRING_TTL_SECONDS,
      createdAt: now.toISOString(),
    };
    if (await pairing.create(record)) {
      metric("PairingsStarted");
      const body: PairingStartResponse = { pairingId: record.pairingId, code: record.code, secret, expiresAt: new Date(record.expiresAt * 1000).toISOString() };
      return ok(body, 201);
    }
  }
  throw new Error("Could not allocate a pairing code");
}

async function pairingStatus(req: ApiRequest, ctx: AppContext) {
  const pairingId = v.id(req.params.pairingId, "pairingId");
  const secret = req.headers["x-pairing-secret"];
  const record = await need(ctx.pairing, "pairing").get(pairingId);
  // The same answer for "unknown" and "wrong secret": nothing to probe.
  if (!record || typeof secret !== "string" || !secretMatches(secret, record.secretHash)) notFound("Unknown pairing");
  const expired = record!.expiresAt <= Math.floor(ctx.clock().getTime() / 1000);
  const body: PairingStatusResponse & { devToken?: string } = {
    status: expired && record!.status !== "consumed" ? "expired" : record!.status,
    ...(record!.status === "approved" && !expired ? { username: record!.username, email: record!.email } : {}),
  };
  // Local dev server only: there is no Cognito to sign in to, so hand out a dev token.
  if (ctx.config.devMode && body.status === "approved" && record!.userId) body.devToken = `dev.${record!.userId}`;
  return ok(body);
}

export const publicRoutes: Route[] = [
  { method: "GET", path: "/v1/health", auth: false, handler: health },
  { method: "GET", path: "/v1/client-config", auth: false, handler: clientConfig },
  { method: "GET", path: "/v1/city", auth: false, handler: city },
  { method: "GET", path: "/v1/air-quality/zones", auth: false, handler: zones },
  { method: "GET", path: "/v1/air-quality/zones/{zoneId}", auth: false, handler: zone },
  { method: "GET", path: "/v1/air-quality/current", auth: false, handler: current },
  { method: "GET", path: "/v1/scenario", auth: false, handler: scenario },
  { method: "POST", path: "/v1/pairing", auth: false, handler: startPairing },
  { method: "GET", path: "/v1/pairing/{pairingId}", auth: false, handler: pairingStatus },
];
