// HTTP-agnostic implementation of the AEROSCOPE watch API (docs/API.md).
// `lambda.mjs` adapts API Gateway events to it; `dev-server.mjs` adapts
// node:http. Request: { method, path, query, headers (lower-case), body }.
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import {
  DEFAULT_PREFERENCES,
  DEFAULT_PRESET,
  aqiCategory,
  categoryRank,
  evaluatePosition,
  historyEntry,
  makePlanner,
  normalizeScenario,
  readingsByZone,
  resolveLocation,
  scenarioForClock,
  scenarioLabel,
  zoneReading,
} from "./engine.mjs";
import { NoEvents, NoPush, metric } from "./notify.mjs";

const ID = /^[A-Za-z0-9._:-]{1,128}$/;
const MODES = new Set(["walk", "cycle", "motor"]);
const PHASES_ACCEPTING_LOCATIONS = new Set(["active", "paused"]);

class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const fail = (status, message, code) => {
  throw new HttpError(status, message, code);
};

const isId = (v) => typeof v === "string" && ID.test(v);
const sha256 = (v) => createHash("sha256").update(v).digest();
const sameSecret = (a, b) => {
  const x = sha256(a);
  const y = sha256(b);
  return timingSafeEqual(x, y);
};
const isIso = (v) => typeof v === "string" && !Number.isNaN(Date.parse(v));
const zoneIds = (v) => (Array.isArray(v) && v.every(isId) && v.length <= 64 ? v : null);

/**
 * Identity: a Cognito `sub` (when an authorizer is attached) or the pair
 * `x-aeroscope-user` + `x-aeroscope-user-key`. The key is a random secret the
 * apps generate and keep in the Keychain; the backend pins its SHA-256 on first
 * use and requires it afterwards, so knowing a user id is not enough to act as
 * that user. Operator routes (demo simulation, scenario pinning) need a separate
 * operator key and are disabled when none is configured.
 *
 * @param {object} deps
 * @param {import("./store.mjs").MemoryStore | import("./store.mjs").DynamoStore} deps.store
 * @param {string | null} [deps.operatorKey]
 * @param {boolean} [deps.allowOperatorWithoutKey] Only for the local dev server.
 */
export function createApp({
  store,
  push = NoPush,
  events = NoEvents,
  clock = () => new Date(),
  newId = () => randomUUID(),
  version = "1.0.0",
  operatorKey = null,
  allowOperatorWithoutKey = false,
} = {}) {
  const routes = [];
  /** auth: "user" (user id + key), "none", or "operator" (operator key; acts for the user named in x-aeroscope-user). */
  const route = (method, pattern, handler, { auth = "user", idempotent = false } = {}) =>
    routes.push({ method, pattern: new RegExp(`^${pattern}$`), handler, auth, idempotent });

  async function authenticateUser(request, headers) {
    if (request.authUserId) return request.authUserId;
    const userId = headers["x-aeroscope-user"];
    const key = headers["x-aeroscope-user-key"];
    if (!isId(userId)) fail(401, "Missing or invalid x-aeroscope-user header", "unauthenticated");
    if (typeof key !== "string" || key.length < 32 || key.length > 256) fail(401, "Missing or invalid x-aeroscope-user-key header", "unauthenticated");
    const keyHash = sha256(key).toString("hex");
    const created = await store.putIfAbsent(userId, "AUTH", { keyHash, createdAt: clock().toISOString() });
    if (created) return userId;
    const record = await store.get(userId, "AUTH");
    if (!record || !timingSafeEqual(Buffer.from(record.keyHash, "hex"), Buffer.from(keyHash, "hex"))) {
      metric("AuthFailures");
      fail(403, "User key does not match this user", "forbidden");
    }
    return userId;
  }

  function authenticateOperator(headers) {
    if (!operatorKey) {
      if (allowOperatorWithoutKey) return;
      fail(403, "Operator routes are disabled. Set the OperatorKey stack parameter to enable them.", "forbidden");
    }
    const given = headers["x-aeroscope-operator-key"];
    if (typeof given !== "string" || !sameSecret(given, operatorKey)) fail(403, "Invalid operator key", "forbidden");
  }

  async function activeScenario(now) {
    const scenario = (await store.getScenarioOverride()) ?? (await store.latestDashboardScenario()) ?? scenarioForClock(DEFAULT_PRESET, now);
    return normalizeScenario(scenario);
  }

  async function preferencesFor(userId) {
    return { ...DEFAULT_PREFERENCES, ...((await store.get(userId, "PREFS")) ?? {}) };
  }

  async function tripAlerts(userId, tripId) {
    return (await store.list(userId, "ALERT#")).filter((a) => a.tripId === tripId);
  }

  async function getTrip(userId, tripId) {
    if (!isId(tripId)) fail(400, "Invalid trip id");
    return (await store.get(userId, `TRIP#${tripId}`)) ?? fail(404, "Unknown trip");
  }

  async function saveAlert(userId, alert) {
    await store.put(userId, `ALERT#${alert.id}`, alert);
  }

  async function raise(userId, alert, { pushToDevices }) {
    await saveAlert(userId, alert);
    metric("AlertsRaised", 1, { Origin: alert.origin });
    await events.publish(userId, { type: "alert.raised", tripId: alert.tripId, alert: { ...alert, category: aqiCategory(alert.aqi) }, at: alert.createdAt });
    if (pushToDevices) await push.send(await store.list(userId, "DEVICE#"), alert);
  }

  /** Evaluates a position for a trip, records it, raises any alert and publishes the move. */
  async function recordPosition(userId, trip, location, { source, pushToDevices, now }) {
    const city = await store.getCity();
    const scenario = await activeScenario(now);
    const history = (await tripAlerts(userId, trip.tripId)).map(historyEntry);
    const result = evaluatePosition({
      dataset: city, scenario, location, prefs: await preferencesFor(userId), trip, history, now, newId,
    });
    if (result.outside) {
      const { nearestZoneName: name, distanceKm: km } = result.outside;
      fail(404, `Outside Delhi coverage${name ? ` (nearest: ${name}, ${Math.round(km)} km)` : ""}`, "outside-coverage");
    }
    if (result.error) fail(400, result.error);
    const { evaluation } = result;
    if (evaluation.alert) {
      trip.alertCount = (trip.alertCount ?? 0) + 1;
      await raise(userId, evaluation.alert, { pushToDevices });
    }
    trip.lastEvaluation = evaluation;
    trip.lastEvaluationSource = source;
    trip.lastEvaluationAt = now.toISOString();
    trip.updatedAt = now.toISOString();
    await store.put(userId, `TRIP#${trip.tripId}`, trip);
    await events.publish(userId, {
      type: "trip.location",
      tripId: trip.tripId,
      zoneId: evaluation.match.zoneId,
      zoneName: evaluation.match.zoneName,
      world: evaluation.match.world,
      aqi: evaluation.reading.aqi,
      category: aqiCategory(evaluation.reading.aqi),
      simulated: Boolean(location.simulated),
      source,
      at: now.toISOString(),
    });
    return evaluation;
  }

  // ------------------------------------------------------------ Read-only

  route("GET", "/v1/health", async () => {
    const now = clock();
    const city = await store.getCity();
    return { body: { status: "ok", version, provenance: city.provenance, scenario: await activeScenario(now), push: push.configured, realtime: events.configured } };
  }, { auth: "none" });

  route("GET", "/v1/city", async () => {
    const now = clock();
    return { body: { dataset: await store.getCity(), scenario: await activeScenario(now), generatedAt: now.toISOString() } };
  }, { auth: "none" });

  route("GET", "/v1/air-quality/current", async ({ query }) => {
    const now = clock();
    const city = await store.getCity();
    const lat = Number(query.lat);
    const lon = Number(query.lon);
    const location = {
      geo: query.lat !== undefined && Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : undefined,
      zoneId: isId(query.zoneId) ? query.zoneId : undefined,
      simulated: false,
    };
    const resolved = resolveLocation(city, location);
    if (resolved.outside) {
      const { nearestZoneName: name, distanceKm: km } = resolved.outside;
      fail(404, `Outside Delhi coverage${name ? ` (nearest: ${name}, ${Math.round(km)} km)` : ""}`, "outside-coverage");
    }
    if (resolved.error) fail(400, resolved.error);
    const scenario = await activeScenario(now);
    const zone = city.zones.find((z) => z.id === resolved.match.zoneId);
    return { body: { reading: zoneReading(zone, scenario, city.provenance), match: resolved.match, scenario, generatedAt: now.toISOString() } };
  }, { auth: "none" });

  route("POST", "/v1/routes/compare", async ({ body }) => {
    const now = clock();
    if (!isId(body?.fromZoneId) || !isId(body?.toZoneId)) fail(400, "Expected { fromZoneId, toZoneId, mode }");
    const city = await store.getCity();
    const scenario = await activeScenario(now);
    const aqi = Object.fromEntries(Object.entries(readingsByZone(city, scenario)).map(([k, r]) => [k, r.aqi]));
    const comparison = makePlanner(city, aqi).compare(
      body.fromZoneId, body.toZoneId, MODES.has(body.mode) ? body.mode : "walk", zoneIds(body.plannedZoneIds) ?? [], scenarioLabel(scenario), now,
    );
    return comparison ? { body: comparison } : fail(404, "No route between those zones");
  }, { auth: "none" });

  route("GET", "/v1/alerts", async ({ userId, query }) => {
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const alerts = (await store.list(userId, "ALERT#")).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
    return { body: { alerts } };
  });

  route("GET", "/v1/trips/(?<tripId>[^/]+)", async ({ userId, params }) => {
    const trip = await getTrip(userId, params.tripId);
    const alerts = (await tripAlerts(userId, trip.tripId)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return {
      body: {
        tripId: trip.tripId, phase: trip.phase, plannedZoneIds: trip.plannedZoneIds ?? [], lastEvaluation: trip.lastEvaluation ?? null,
        lastEvaluationSource: trip.lastEvaluationSource ?? null, lastEvaluationAt: trip.lastEvaluationAt ?? null, alerts,
      },
    };
  });

  route("GET", "/v1/preferences", async ({ userId }) => ({ body: await preferencesFor(userId) }));

  route("GET", "/v1/scenario", async () => {
    const scenario = await activeScenario(clock());
    return { body: { ...scenario, label: scenarioLabel(scenario) } };
  }, { auth: "none" });

  // ------------------------------------------------------------ Trips

  route("POST", "/v1/trips", async ({ userId, body, client }) => {
    const now = clock();
    if (!isId(body?.tripId) || !isIso(body?.startedAt)) fail(400, "Expected { tripId, startedAt, mode, ... }");
    const existing = await store.get(userId, `TRIP#${body.tripId}`);
    if (existing) return { body: { tripPhase: existing.phase, plannedZoneIds: existing.plannedZoneIds } };
    const trip = {
      tripId: body.tripId,
      userId,
      phase: "active",
      mode: MODES.has(body.mode) ? body.mode : "walk",
      source: body.source === "demo" ? "demo" : "live",
      startedAt: body.startedAt,
      destinationZoneId: isId(body.destinationZoneId) ? body.destinationZoneId : null,
      plannedZoneIds: zoneIds(body.plannedZoneIds) ?? [],
      alertCount: 0,
      rerouteCount: 0,
      updatedAt: now.toISOString(),
    };
    await store.put(userId, `TRIP#${trip.tripId}`, trip);
    metric("TripsStarted");
    await events.publish(userId, { type: "trip.started", tripId: trip.tripId, mode: trip.mode, destinationZoneId: trip.destinationZoneId, plannedZoneIds: trip.plannedZoneIds, at: trip.startedAt });
    let evaluation = null;
    if (body.origin) {
      evaluation = await recordPosition(userId, trip, body.origin, { source: "device", pushToDevices: client !== "watchOS", now });
    }
    return { status: 201, body: { tripPhase: "active", plannedZoneIds: trip.plannedZoneIds, evaluation, alert: evaluation?.alert ?? null } };
  }, { idempotent: true });

  route("POST", "/v1/trips/(?<tripId>[^/]+)/events", async ({ userId, params, body, client }) => {
    const now = clock();
    const trip = await getTrip(userId, params.tripId);
    if (!["location", "pause", "resume", "end"].includes(body?.type) || !isIso(body?.at)) fail(400, "Expected { type, at }");

    // An alert the watch raised offline: store it under its own id first so
    // the evaluation below sees it in the history and does not repeat it.
    const deviceAlert = body.deviceAlert;
    if (deviceAlert && isId(deviceAlert.id) && isId(deviceAlert.zoneId) && Number.isFinite(deviceAlert.aqi)) {
      if (!(await store.get(userId, `ALERT#${deviceAlert.id}`))) {
        trip.alertCount = (trip.alertCount ?? 0) + 1;
        await raise(userId, { ...deviceAlert, tripId: trip.tripId, origin: "device", status: deviceAlert.status ?? "active" }, { pushToDevices: false });
      }
    }

    switch (body.type) {
      case "location": {
        if (!PHASES_ACCEPTING_LOCATIONS.has(trip.phase)) fail(409, "Trip is not accepting locations");
        if (!body.location) fail(400, "Missing location");
        const evaluation = await recordPosition(userId, trip, body.location, { source: "device", pushToDevices: client !== "watchOS", now });
        return { body: { tripPhase: trip.phase, evaluation, alert: evaluation.alert } };
      }
      case "pause":
        if (trip.phase !== "active") fail(409, "Trip is not active");
        trip.phase = "paused";
        break;
      case "resume":
        if (trip.phase !== "paused") fail(409, "Trip is not paused");
        trip.phase = "active";
        break;
      case "end":
        if (trip.phase === "ended") fail(409, "Trip already ended");
        trip.phase = "ended";
        trip.endedAt = body.at;
        metric("TripsEnded");
        break;
    }
    trip.updatedAt = now.toISOString();
    await store.put(userId, `TRIP#${trip.tripId}`, trip);
    await events.publish(userId, { type: `trip.${body.type === "end" ? "ended" : body.type === "pause" ? "paused" : "resumed"}`, tripId: trip.tripId, at: body.at });
    return { body: { tripPhase: trip.phase } };
  }, { idempotent: true });

  // Demo operator: move the trip's avatar to a zone or coordinate from outside
  // the watch (e.g. a presenter's laptop). The watch learns about it by push
  // and by polling GET /v1/trips/{id}.
  route("POST", "/v1/trips/(?<tripId>[^/]+)/simulate", async ({ userId, params, body }) => {
    const now = clock();
    if (!userId) fail(400, "Name the trip owner in x-aeroscope-user");
    const trip = await getTrip(userId, params.tripId);
    if (trip.phase !== "active") fail(409, "Trip is not active");
    const geo = Number.isFinite(body?.lat) && Number.isFinite(body?.lon) ? { lat: body.lat, lon: body.lon } : undefined;
    if (!geo && !isId(body?.zoneId)) fail(400, "Expected { zoneId } or { lat, lon }");
    const evaluation = await recordPosition(userId, trip, { geo, zoneId: body.zoneId, simulated: true }, { source: "operator", pushToDevices: true, now });
    return { body: { tripPhase: trip.phase, evaluation, alert: evaluation.alert } };
  }, { auth: "operator", idempotent: true });

  route("POST", "/v1/trips/(?<tripId>[^/]+)/route", async ({ userId, params, body }) => {
    const now = clock();
    const trip = await getTrip(userId, params.tripId);
    const ids = zoneIds(body?.zoneIds);
    if (!ids || !["alternative", "current"].includes(body?.choice)) fail(400, "Expected { routeId, choice, zoneIds }");
    if (body.choice === "alternative" && ids.length) {
      const planned = trip.plannedZoneIds ?? [];
      const cut = planned.indexOf(ids[0]);
      trip.plannedZoneIds = [...(cut >= 0 ? planned.slice(0, cut) : []), ...ids];
      trip.rerouteCount = (trip.rerouteCount ?? 0) + 1;
    }
    trip.updatedAt = now.toISOString();
    await store.put(userId, `TRIP#${trip.tripId}`, trip);
    let alert = null;
    if (isId(body.alertId)) {
      alert = await store.get(userId, `ALERT#${body.alertId}`);
      if (alert) {
        alert.status = body.choice === "alternative" ? "rerouted" : "acknowledged";
        alert.updatedAt = now.toISOString();
        await saveAlert(userId, alert);
      }
    }
    metric(body.choice === "alternative" ? "ReroutesAccepted" : "ReroutesDeclined");
    await events.publish(userId, { type: "route.changed", tripId: trip.tripId, choice: body.choice, plannedZoneIds: trip.plannedZoneIds, at: now.toISOString() });
    return { body: { tripPhase: trip.phase, plannedZoneIds: trip.plannedZoneIds, alert } };
  }, { idempotent: true });

  // ------------------------------------------------------------ Alerts

  route("POST", "/v1/alerts/(?<alertId>[^/]+)/actions", async ({ userId, params, body }) => {
    const now = clock();
    if (!isId(params.alertId)) fail(400, "Invalid alert id");
    const alert = (await store.get(userId, `ALERT#${params.alertId}`)) ?? fail(404, "Unknown alert");
    let routeComparison = null;
    switch (body?.action) {
      case "acknowledge":
        alert.status = "acknowledged";
        break;
      case "dismiss":
        alert.status = "dismissed";
        break;
      case "request-route": {
        alert.status = "reroute-requested";
        if (isId(body.currentZoneId) && isId(body.destinationZoneId)) {
          const city = await store.getCity();
          const scenario = await activeScenario(now);
          const aqi = Object.fromEntries(Object.entries(readingsByZone(city, scenario)).map(([k, r]) => [k, r.aqi]));
          routeComparison = makePlanner(city, aqi).compare(
            body.currentZoneId, body.destinationZoneId, MODES.has(body.mode) ? body.mode : "walk",
            zoneIds(body.plannedZoneIds) ?? [], scenarioLabel(scenario), now,
          );
          if (routeComparison) await events.publish(userId, { type: "route.compared", tripId: alert.tripId, comparison: routeComparison, at: now.toISOString() });
        }
        break;
      }
      default:
        fail(400, "Expected { action: acknowledge | dismiss | request-route }");
    }
    alert.updatedAt = now.toISOString();
    await saveAlert(userId, alert);
    metric("AlertActions", 1, { Action: body.action });
    await events.publish(userId, { type: "alert.updated", tripId: alert.tripId, alert: { ...alert, category: aqiCategory(alert.aqi) }, at: now.toISOString() });
    return { body: { alert, routeComparison } };
  }, { idempotent: true });

  // ------------------------------------------------------------ Settings

  route("PUT", "/v1/preferences", async ({ userId, body }) => {
    if (!body || typeof body !== "object" || categoryRank(body.threshold) < 0) fail(400, "Invalid preferences");
    const current = await preferencesFor(userId);
    // Last writer wins across watch, iPhone and backend.
    if (isIso(body.updatedAt) && isIso(current.updatedAt) && Date.parse(body.updatedAt) < Date.parse(current.updatedAt)) {
      return { body: current };
    }
    const prefs = {
      alertsEnabled: Boolean(body.alertsEnabled),
      threshold: body.threshold,
      cooldownMinutes: Math.min(240, Math.max(1, Number(body.cooldownMinutes) || 15)),
      onlyDuringTrips: Boolean(body.onlyDuringTrips),
      sensitiveGroup: Boolean(body.sensitiveGroup),
      lookAhead: body.lookAhead !== false,
      travelMode: MODES.has(body.travelMode) ? body.travelMode : "walk",
      staleAfterMinutes: Math.min(240, Math.max(5, Number(body.staleAfterMinutes) || 30)),
      updatedAt: isIso(body.updatedAt) ? body.updatedAt : clock().toISOString(),
    };
    await store.put(userId, "PREFS", prefs);
    return { body: prefs };
  }, { idempotent: true });

  route("PUT", "/v1/devices/(?<deviceId>[^/]+)", async ({ userId, params, body }) => {
    if (!isId(params.deviceId) || typeof body?.token !== "string" || !/^[0-9a-f]{16,200}$/i.test(body.token)) {
      fail(400, "Expected { token (hex), platform, environment, bundleId }");
    }
    const device = await push.registerDevice(userId, {
      deviceId: params.deviceId,
      token: body.token.toLowerCase(),
      platform: body.platform === "iOS" ? "iOS" : "watchOS",
      environment: body.environment === "production" ? "production" : "sandbox",
      bundleId: typeof body.bundleId === "string" ? body.bundleId : null,
      updatedAt: clock().toISOString(),
    });
    await store.put(userId, `DEVICE#${params.deviceId}`, device);
    return { body: { registered: true, push: Boolean(device.endpointArn) } };
  });

  // Demo operator: pin the scenario used for readings (otherwise the
  // dashboard's latest saved scenario, otherwise the clock).
  route("PUT", "/v1/scenario", async ({ body }) => {
    if (!body || typeof body.preset !== "string" || !Number.isInteger(body.timeIndex)) fail(400, "Expected { preset, timeIndex }");
    const scenario = normalizeScenario(body);
    await store.setScenarioOverride(scenario);
    await events.publish("GLOBAL", { type: "scenario.changed", scenario, at: clock().toISOString() });
    return { body: { ...scenario, label: scenarioLabel(scenario) } };
  }, { auth: "operator" });

  // ------------------------------------------------------------ Dispatch

  async function handle(request) {
    const method = (request.method ?? "GET").toUpperCase();
    const path = (request.path ?? "/").replace(/\/+$/, "") || "/";
    const headers = request.headers ?? {};
    try {
      let methodMismatch = false;
      for (const r of routes) {
        const m = r.pattern.exec(path);
        if (!m) continue;
        if (r.method !== method) {
          methodMismatch = true;
          continue;
        }
        const params = Object.fromEntries(Object.entries(m.groups ?? {}).map(([k, v]) => [k, decodeURIComponent(v)]));
        let userId = null;
        if (r.auth === "user") {
          userId = await authenticateUser(request, headers);
        } else if (r.auth === "operator") {
          authenticateOperator(headers);
          userId = headers["x-aeroscope-user"] ?? null;
          if (userId !== null && !isId(userId)) fail(400, "Invalid x-aeroscope-user header");
        }
        const key = headers["idempotency-key"];
        if (r.idempotent && key !== undefined) {
          if (!isId(key)) fail(400, "Invalid Idempotency-Key");
          const stored = await store.get(userId ?? "GLOBAL", `IDEMP#${key}`);
          if (stored) {
            metric("IdempotentReplays");
            return { status: stored.status, body: { ...stored.body, replayed: true } };
          }
        }
        const result = await r.handler({ ...request, method, path, params, userId, headers, query: request.query ?? {}, client: headers["x-aeroscope-client"] });
        const response = { status: result.status ?? 200, body: result.body };
        if (r.idempotent && key !== undefined) await store.put(userId ?? "GLOBAL", `IDEMP#${key}`, response);
        return response;
      }
      return methodMismatch ? { status: 405, body: { error: "Method not allowed" } } : { status: 404, body: { error: "Not found" } };
    } catch (err) {
      if (err instanceof HttpError) return { status: err.status, body: { error: err.message, ...(err.code ? { code: err.code } : {}) } };
      console.error("watch api failure", err);
      metric("Errors");
      return { status: 500, body: { error: "Internal error" } };
    }
  }

  return { handle };
}
