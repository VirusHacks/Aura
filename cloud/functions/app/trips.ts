/**
 * Trip routes: start, lifecycle events, positions (with alert evaluation),
 * route selection and status. The trip item is the canonical state; events go
 * out only after it is saved.
 */
import { getAqiCategory } from "../../../lib/aqi";
import {
  type AlertPreferences,
  DOMAIN_EVENTS,
  type Evaluation,
  type EvaluationSource,
  type LocationPayload,
  type OperationResult,
  type PollutionAlert,
  type SelectedRoute,
  type TripStatusResponse,
} from "../../../types/api";
import { DEFAULT_PREFERENCES, buildAlert, categoryRank, effectiveThresholdAqi, historyEntry } from "../domain/alerts";
import { scenarioLabel, withLabel } from "../domain/city";
import { evaluatePosition, suppressionOf } from "../domain/evaluate";
import { makeZoneGraph } from "../domain/routing/zone-graph";
import { type TripCommand, type TripRecord, newTrip, recordSample, toStatus, transition } from "../domain/trips";
import { badRequest, conflict, isConditionalFailure, notFound } from "../shared/errors";
import { metric } from "../shared/log";
import * as v from "../shared/validation";
import { type DomainEvent, domainEvent } from "../services/events";
import { type AppContext, activeScenario, loadCity, need } from "./context";
import { type ApiRequest, type AuthUser, type Route, ok } from "./http";

const DEDUPE_TTL_SECONDS = 3 * 86_400;
const MAX_SAVE_ATTEMPTS = 3;
/** An active trip with no activity for this long is treated as abandoned. */
const STALE_TRIP_MS = 6 * 3_600_000;

export async function preferencesFor(ctx: AppContext, userId: string): Promise<AlertPreferences> {
  const stored = await ctx.users?.getPreferences(userId);
  return { ...DEFAULT_PREFERENCES, ...(stored ?? {}) };
}

/** Who reported this position. Dashboard moves are always simulated. */
function sourceOf(req: ApiRequest, location: LocationPayload): EvaluationSource {
  const client = req.headers["x-aeroscope-client"];
  if (client === "web" || (location.world && !location.geo)) return "dashboard";
  return "device";
}

/** Load → change → save with optimistic concurrency, retrying on a lost race. */
async function mutateTrip(ctx: AppContext, userId: string, tripId: string, change: (trip: TripRecord) => Promise<TripRecord>): Promise<TripRecord> {
  const trips = need(ctx.trips, "trips");
  for (let attempt = 1; ; attempt++) {
    const current = (await trips.get(userId, tripId)) ?? notFound("Unknown trip");
    const next = await change(current);
    try {
      return await trips.save({ ...next, version: current.version });
    } catch (err) {
      if (!isConditionalFailure(err) || attempt >= MAX_SAVE_ATTEMPTS) throw err;
      metric("TripWriteConflicts");
    }
  }
}

interface PositionResult {
  trip: TripRecord;
  evaluation: Evaluation;
  alert: PollutionAlert | null;
  events: DomainEvent[];
}

/**
 * Evaluates one position for a trip and folds it in. Alert creation is guarded
 * twice: by the history rules and by a conditional "trip/zone/category" claim,
 * so concurrent or repeated requests never raise the same alert twice.
 */
async function applyPosition(
  ctx: AppContext,
  user: AuthUser,
  trip: TripRecord,
  location: LocationPayload,
  source: EvaluationSource,
  at: string,
  correlationId: string,
  own: Map<string, PollutionAlert>,
): Promise<PositionResult> {
  const alertsRepo = need(ctx.alerts, "alerts");
  const now = ctx.clock();
  const city = await loadCity(ctx);
  const scenario = await activeScenario(ctx, now);
  const prefs = await preferencesFor(ctx, user.userId);
  // On an optimistic-lock retry, this request's own new alert is already stored;
  // leave it out of the history so the decision (and its event) is reproduced.
  const mine = new Set([...own.values()].map((a) => a.id));
  const existing = (await alertsRepo.listForTrip(user.userId, trip.tripId)).filter((a) => !mine.has(a.id));
  const pe = evaluatePosition({ city, scenario, location, prefs, trip, history: existing.map(historyEntry), dataAsOf: now, now });
  metric("AlertEvaluations", 1, { Source: source });

  const events: DomainEvent[] = [];
  const base = { userId: user.userId, correlationId, tripId: trip.tripId, now };
  let alert: PollutionAlert | null = null;
  let suppression = suppressionOf(pe.decision);

  if ("raise" in pe.decision) {
    const target = pe.decision.raise.reading;
    const dedupeKey = `${trip.tripId}#${target.zoneId}#${categoryRank(getAqiCategory(target.aqi))}`;
    const candidate = buildAlert({
      id: ctx.newId(),
      userId: user.userId,
      tripId: trip.tripId,
      kind: pe.decision.raise.kind,
      reading: target,
      prefs,
      scenarioLabel: scenarioLabel(scenario),
      dataAsOf: now.toISOString(),
      now,
      source,
    });
    const earlier = own.get(dedupeKey);
    if (earlier) {
      // Created by an earlier attempt of this same request (optimistic-lock retry).
      alert = earlier;
      events.push(domainEvent(DOMAIN_EVENTS.AlertCreated, { ...base, zoneId: earlier.zoneId, payload: { alert: earlier } }));
    } else if (await alertsRepo.claimDedupe(user.userId, dedupeKey, candidate.id, DEDUPE_TTL_SECONDS)) {
      await alertsRepo.createIfAbsent(candidate, ctx.config.alertRetentionDays);
      own.set(dedupeKey, candidate);
      alert = candidate;
      metric("AlertsRaised", 1, { Kind: candidate.kind, Source: source });
      events.push(domainEvent(DOMAIN_EVENTS.AlertCreated, { ...base, zoneId: candidate.zoneId, payload: { alert: candidate } }));
    } else {
      suppression = "already-warned";
      metric("AlertsDeduplicated");
    }
  } else {
    metric("AlertsSuppressed", 1, { Reason: suppression ?? "unknown" });
  }

  // Upward crossing of the user's threshold (for analytics and the dashboard's zone highlight).
  const threshold = effectiveThresholdAqi(prefs);
  const previousAqi = trip.lastEvaluation?.reading.aqi ?? null;
  if (pe.reading.aqi >= threshold && (previousAqi === null || previousAqi < threshold)) {
    events.push(
      domainEvent(DOMAIN_EVENTS.AirQualityThresholdCrossed, {
        ...base,
        zoneId: pe.reading.zoneId,
        payload: { zoneId: pe.reading.zoneId, zoneName: pe.reading.zoneName, aqi: pe.reading.aqi, category: pe.reading.category, thresholdAqi: threshold, isDemo: true },
      }),
    );
  }

  const evaluation: Evaluation = {
    reading: pe.reading,
    match: pe.match,
    upcoming: pe.upcoming,
    alert,
    suppression: alert ? null : suppression,
    scenario: withLabel(scenario),
    dataAsOf: now.toISOString(),
  };
  const keepPosition = prefs.locationConsent !== false;
  const folded = recordSample(
    trip,
    { at, zoneId: pe.match.zoneId, zoneName: pe.match.zoneName, aqi: pe.reading.aqi, world: pe.match.world, simulated: location.simulated },
    keepPosition,
  );
  const next: TripRecord = {
    ...folded.trip,
    alertCount: trip.alertCount + (alert ? 1 : 0),
    lastEvaluation: evaluation,
    lastEvaluationSource: source,
    lastEvaluationAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };

  if (folded.zoneChanged) {
    events.push(
      domainEvent(DOMAIN_EVENTS.TripZoneChanged, {
        ...base,
        zoneId: pe.match.zoneId,
        payload: { fromZoneId: folded.previousZoneId, toZoneId: pe.match.zoneId, zoneName: pe.match.zoneName, aqi: pe.reading.aqi, category: pe.reading.category, isDemo: true },
      }),
    );
  }
  events.push(
    domainEvent(DOMAIN_EVENTS.TripLocationUpdated, {
      ...base,
      zoneId: pe.match.zoneId,
      payload: {
        world: keepPosition ? next.currentWorld : null,
        zoneId: pe.match.zoneId,
        zoneName: pe.match.zoneName,
        aqi: pe.reading.aqi,
        category: pe.reading.category,
        simulated: location.simulated,
        source,
        at,
      },
    }),
  );
  return { trip: next, evaluation, alert, events };
}

async function finishPosition(ctx: AppContext, user: AuthUser, result: PositionResult, previousZoneId: string | null) {
  if (result.trip.currentZoneId && result.trip.currentZoneId !== previousZoneId) {
    const prefs = await preferencesFor(ctx, user.userId);
    if (prefs.locationConsent !== false) {
      await need(ctx.trips, "trips").addTransition(
        user.userId,
        result.trip.tripId,
        { at: result.trip.lastLocationAt!, fromZoneId: previousZoneId, toZoneId: result.trip.currentZoneId, aqi: result.evaluation.reading.aqi },
        ctx.config.locationRetentionDays,
      );
    }
  }
  await ctx.events.publish(result.events);
}

async function statusOf(ctx: AppContext, trip: TripRecord): Promise<TripStatusResponse> {
  const alerts = await need(ctx.alerts, "alerts").listForTrip(trip.userId, trip.tripId);
  return toStatus(trip, alerts, ctx.clock());
}

// ---------------------------------------------------------------- Handlers

async function startTrip(req: ApiRequest & { user: AuthUser }, ctx: AppContext) {
  const body = v.object(req.body);
  const tripId = v.id(body.tripId, "tripId");
  const startedAt = v.isoDate(body.startedAt, "startedAt");
  const trips = need(ctx.trips, "trips");
  const existing = await trips.get(req.user.userId, tripId);
  if (existing) return ok({ tripPhase: existing.phase, plannedZoneIds: existing.plannedZoneIds, trip: await statusOf(ctx, existing) } satisfies OperationResult);

  const active = await trips.getActive(req.user.userId);
  if (active) {
    const idleMs = ctx.clock().getTime() - Date.parse(active.updatedAt);
    if (idleMs < STALE_TRIP_MS) conflict("Another trip is still active. End it before starting a new one.");
    // A trip untouched for hours was abandoned (app closed, battery died): close it.
    await trips.save({ ...transition(active, "end", active.lastLocationAt ?? active.updatedAt), updatedAt: ctx.clock().toISOString() });
    metric("StaleTripsEnded");
  }

  const city = await loadCity(ctx);
  const origin = body.origin === undefined || body.origin === null ? null : v.locationPayload(body.origin);
  const destinationZoneId = v.optionalId(body.destinationZoneId, "destinationZoneId");
  if (destinationZoneId && !city.byId.has(destinationZoneId)) badRequest(`Unknown zone ${destinationZoneId}`);
  const planned = v.zoneIds(body.plannedZoneIds, "plannedZoneIds").filter((z) => city.byId.has(z));
  const source = v.optionalOneOf(body.source, ["live", "demo"] as const, "live");
  const mode = v.optionalOneOf(body.mode, v.TRAVEL_MODES, "walk");
  const now = ctx.clock();

  let trip = newTrip({
    userId: req.user.userId,
    tripId,
    source,
    mode,
    startedAt,
    originZoneId: origin?.zoneId ?? null,
    destinationZoneId,
    plannedZoneIds: planned,
    isDemo: source === "demo" || Boolean(origin?.simulated),
    now,
  });
  try {
    await trips.create(trip);
  } catch (err) {
    if (!isConditionalFailure(err)) throw err;
    const raced = (await trips.get(req.user.userId, tripId))!;
    return ok({ tripPhase: raced.phase, plannedZoneIds: raced.plannedZoneIds, trip: await statusOf(ctx, raced) } satisfies OperationResult);
  }
  metric("TripsStarted", 1, { Source: source });

  const base = { userId: req.user.userId, correlationId: req.correlationId, tripId, now };
  if (!origin) {
    await ctx.events.publish([domainEvent(DOMAIN_EVENTS.TripStarted, { ...base, payload: { trip: await statusOf(ctx, trip) } })]);
    return ok({ tripPhase: "active", plannedZoneIds: trip.plannedZoneIds, evaluation: null, alert: null, trip: await statusOf(ctx, trip) } satisfies OperationResult, 201);
  }

  const own = new Map<string, PollutionAlert>();
  let result: PositionResult | null = null;
  trip = await mutateTrip(ctx, req.user.userId, tripId, async (current) => {
    result = await applyPosition(ctx, req.user, current, origin, sourceOf(req, origin), startedAt, req.correlationId, own);
    const originZoneId = result.evaluation.match.zoneId;
    // Plan a route from the origin zone when the client didn't send one.
    const plannedZoneIds =
      destinationZoneId && current.plannedZoneIds.length === 0
        ? (makeZoneGraph(city, new Map()).path(originZoneId, destinationZoneId, "distance") ?? [])
        : current.plannedZoneIds;
    return { ...result.trip, originZoneId, plannedZoneIds };
  });
  const r = result as unknown as PositionResult;
  const started = domainEvent(DOMAIN_EVENTS.TripStarted, { ...base, zoneId: trip.originZoneId, payload: { trip: await statusOf(ctx, trip) } });
  await finishPosition(ctx, req.user, { ...r, trip, events: [started, ...r.events] }, null);
  return ok(
    { tripPhase: "active", plannedZoneIds: trip.plannedZoneIds, evaluation: r.evaluation, alert: r.alert, trip: await statusOf(ctx, trip) } satisfies OperationResult,
    201,
  );
}

async function tripEvent(req: ApiRequest & { user: AuthUser }, ctx: AppContext) {
  const body = v.object(req.body);
  const tripId = v.id(req.params.tripId, "tripId");
  const type = v.oneOf(body.type, ["location", "pause", "resume", "end"] as const, "type");
  const at = v.isoDate(body.at, "at");
  const alertsRepo = need(ctx.alerts, "alerts");
  const now = ctx.clock();
  const base = { userId: req.user.userId, correlationId: req.correlationId, tripId, now };

  // An alert the watch raised from cached data while offline: keep its id so it is not repeated.
  let deviceAlertEvent: DomainEvent | null = null;
  let deviceAlertCreated = false;
  if (v.isObject(body.deviceAlert)) {
    const d = body.deviceAlert;
    if (v.isId(d.id) && v.isId(d.zoneId) && v.isFiniteNumber(d.aqi)) {
      const city = await loadCity(ctx);
      const zone = city.byId.get(d.zoneId as string);
      if (zone) {
        const createdAt = typeof d.createdAt === "string" && !Number.isNaN(Date.parse(d.createdAt)) ? new Date(d.createdAt).toISOString() : now.toISOString();
        const aqi = Math.round(d.aqi as number);
        const alert: PollutionAlert = {
          id: d.id as string,
          alertId: d.id as string,
          tripId,
          userId: req.user.userId,
          zoneId: zone.id,
          zoneName: zone.name,
          aqi,
          category: getAqiCategory(aqi),
          pm25: v.isFiniteNumber(d.pm25) ? Math.round(d.pm25) : null,
          kind: v.optionalOneOf(d.kind, ["entered-zone", "escalation", "upcoming-zone"] as const, "entered-zone"),
          origin: "device",
          status: "active",
          reason: `Raised on the watch from cached data while offline (AQI ${aqi}).`,
          source: "CACHED",
          observedAt: createdAt,
          createdAt,
          updatedAt: createdAt,
          acknowledgedAt: null,
          scenarioLabel: typeof d.scenarioLabel === "string" ? d.scenarioLabel.slice(0, 120) : null,
          simulated: true,
          isDemo: true,
        };
        const dedupeKey = `${tripId}#${zone.id}#${categoryRank(alert.category)}`;
        await alertsRepo.claimDedupe(req.user.userId, dedupeKey, alert.id, DEDUPE_TTL_SECONDS);
        deviceAlertCreated = await alertsRepo.createIfAbsent(alert, ctx.config.alertRetentionDays);
        if (deviceAlertCreated) deviceAlertEvent = domainEvent(DOMAIN_EVENTS.AlertCreated, { ...base, zoneId: zone.id, payload: { alert } });
      }
    }
  }

  if (type === "location") {
    if (body.location === undefined) badRequest("location is required for type location");
    const location = v.locationPayload(body.location);
    const source = sourceOf(req, location);
    let result: PositionResult | null = null;
    let previousZoneId: string | null = null;
    const own = new Map<string, PollutionAlert>();
    const saved = await mutateTrip(ctx, req.user.userId, tripId, async (trip) => {
      if (trip.phase !== "active" && trip.phase !== "paused") conflict("Trip is not accepting locations");
      previousZoneId = trip.currentZoneId;
      result = await applyPosition(ctx, req.user, { ...trip, alertCount: trip.alertCount + (deviceAlertCreated ? 1 : 0) }, location, source, at, req.correlationId, own);
      return result.trip;
    });
    const r = result as unknown as PositionResult;
    await finishPosition(ctx, req.user, { ...r, trip: saved, events: deviceAlertEvent ? [deviceAlertEvent, ...r.events] : r.events }, previousZoneId);
    return ok({ tripPhase: saved.phase, evaluation: r.evaluation, alert: r.alert ?? null } satisfies OperationResult);
  }

  const command = type as TripCommand;
  const saved = await mutateTrip(ctx, req.user.userId, tripId, async (trip) => ({
    ...transition(trip, command, at),
    alertCount: trip.alertCount + (deviceAlertCreated ? 1 : 0),
    updatedAt: now.toISOString(),
  }));
  if (command === "end") metric("TripsEnded");
  const detail = command === "pause" ? DOMAIN_EVENTS.TripPaused : command === "resume" ? DOMAIN_EVENTS.TripResumed : DOMAIN_EVENTS.TripEnded;
  const status = await statusOf(ctx, saved);
  await ctx.events.publish([
    ...(deviceAlertEvent ? [deviceAlertEvent] : []),
    domainEvent(detail, { ...base, payload: command === "end" ? { trip: status } : { tripId, phase: saved.phase, at } }),
  ]);
  return ok({ tripPhase: saved.phase, trip: status } satisfies OperationResult);
}

async function chooseRoute(req: ApiRequest & { user: AuthUser }, ctx: AppContext) {
  const body = v.object(req.body);
  const tripId = v.id(req.params.tripId, "tripId");
  const choice = v.oneOf(body.choice, ["alternative", "current"] as const, "choice");
  const routeId = typeof body.routeId === "string" && body.routeId.length <= 200 ? body.routeId : badRequest("routeId is required");
  const zoneIdsIn = v.zoneIds(body.zoneIds, "zoneIds");
  const alertId = v.optionalId(body.alertId, "alertId");
  const now = ctx.clock();
  const city = await loadCity(ctx);
  const zoneIds = zoneIdsIn.filter((z) => city.byId.has(z));
  const world = parseWorld(body.world) ?? zoneIds.map((z) => ({ x: city.byId.get(z)!.position[0], z: city.byId.get(z)!.position[1] }));
  const geometry = parseGeometry(body.geometry) ?? zoneIds.flatMap((z) => (city.byId.get(z)?.geo ? [[city.byId.get(z)!.geo!.lon, city.byId.get(z)!.geo!.lat] as [number, number]] : []));
  const provider = body.provider === "amazon-location" || body.provider === "demo-zone-graph" ? body.provider : null;

  const saved = await mutateTrip(ctx, req.user.userId, tripId, async (trip) => {
    if (trip.phase === "ended") conflict("Trip has ended");
    const next = { ...trip, updatedAt: now.toISOString() };
    if (choice === "alternative" && zoneIds.length) {
      const cut = trip.plannedZoneIds.indexOf(zoneIds[0]);
      next.plannedZoneIds = [...(cut >= 0 ? trip.plannedZoneIds.slice(0, cut) : []), ...zoneIds];
      next.rerouteCount = trip.rerouteCount + 1;
    }
    const selected: SelectedRoute = { routeId, choice, zoneIds, world, geometry, provider, selectedAt: now.toISOString() };
    next.selectedRoute = selected;
    return next;
  });

  let alert: PollutionAlert | null = null;
  if (alertId) {
    const alertsRepo = need(ctx.alerts, "alerts");
    const found = await alertsRepo.get(req.user.userId, alertId);
    if (found && found.tripId === tripId) {
      alert = { ...found, status: choice === "alternative" ? "rerouted" : "acknowledged", updatedAt: now.toISOString(), acknowledgedAt: found.acknowledgedAt ?? now.toISOString() };
      await alertsRepo.save(alert);
    }
  }
  metric(choice === "alternative" ? "ReroutesAccepted" : "ReroutesDeclined");
  const base = { userId: req.user.userId, correlationId: req.correlationId, tripId, now };
  await ctx.events.publish([
    domainEvent(DOMAIN_EVENTS.RouteSelected, { ...base, payload: { selectedRoute: saved.selectedRoute, plannedZoneIds: saved.plannedZoneIds, choice } }),
    ...(alert ? [domainEvent(DOMAIN_EVENTS.AlertUpdated, { ...base, zoneId: alert.zoneId, payload: { alert } })] : []),
  ]);
  return ok({ tripPhase: saved.phase, plannedZoneIds: saved.plannedZoneIds, alert, trip: await statusOf(ctx, saved) } satisfies OperationResult);
}

function parseWorld(vv: unknown) {
  if (!Array.isArray(vv) || vv.length > 400) return null;
  const pts = vv.filter((p) => v.isObject(p) && v.isFiniteNumber(p.x) && v.isFiniteNumber(p.z)) as { x: number; z: number }[];
  return pts.length === vv.length && pts.length > 0 ? pts.map((p) => ({ x: p.x, z: p.z })) : null;
}

function parseGeometry(vv: unknown): [number, number][] | null {
  if (!Array.isArray(vv) || vv.length > 400) return null;
  const pts = vv.filter((p) => Array.isArray(p) && p.length === 2 && v.isFiniteNumber(p[0]) && v.isFiniteNumber(p[1])) as [number, number][];
  return pts.length === vv.length && pts.length > 0 ? pts : null;
}

async function getTrip(req: ApiRequest & { user: AuthUser }, ctx: AppContext) {
  const tripId = v.id(req.params.tripId, "tripId");
  const trip = (await need(ctx.trips, "trips").get(req.user.userId, tripId)) ?? notFound("Unknown trip");
  return ok(await statusOf(ctx, trip));
}

/** `{ trip }` — the newest trip that hasn't ended, or null. Lets a watch adopt a trip started elsewhere. */
async function getActiveTrip(req: ApiRequest & { user: AuthUser }, ctx: AppContext) {
  const trip = await need(ctx.trips, "trips").getActive(req.user.userId);
  return ok({ trip: trip ? await statusOf(ctx, trip) : null });
}

export const tripRoutes: Route[] = [
  { method: "POST", path: "/v1/trips", auth: true, idempotent: true, handler: startTrip },
  { method: "GET", path: "/v1/trips/active", auth: true, handler: getActiveTrip },
  { method: "GET", path: "/v1/trips/{tripId}", auth: true, handler: getTrip },
  { method: "POST", path: "/v1/trips/{tripId}/events", auth: true, idempotent: true, handler: tripEvent },
  { method: "POST", path: "/v1/trips/{tripId}/route", auth: true, idempotent: true, handler: chooseRoute },
];

