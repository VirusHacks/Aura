import assert from "node:assert/strict";
import { test } from "node:test";
import { createApp } from "../src/app.mjs";
import { LocalEvents } from "../src/notify.mjs";
import { MemoryStore } from "../src/store.mjs";
import { bundledDataset } from "../src/city.mjs";

const dataset = bundledDataset();
const geo = (id) => dataset.zones.find((z) => z.id === id).geo;

const USER_KEY = "k".repeat(16) + "0123456789abcdef0123456789abcdef";

function setup({ operatorKey = "operator-secret" } = {}) {
  let now = new Date("2026-10-11T10:00:00Z");
  let n = 0;
  const events = new LocalEvents();
  const published = [];
  events.subscribe((e) => published.push(e));
  const pushed = [];
  const push = {
    configured: true,
    async registerDevice(_u, d) {
      return { ...d, endpointArn: `arn:test:${d.deviceId}` };
    },
    async send(devices, alert) {
      pushed.push({ devices: devices.length, alert });
      return devices.length;
    },
  };
  const store = new MemoryStore();
  const app = createApp({ store, events, push, clock: () => now, newId: () => `id-${++n}`, operatorKey });
  const call = (method, path, body, headers = {}) =>
    app.handle({ method, path, body, query: {}, headers: {
      "x-aeroscope-user": "user-1", "x-aeroscope-user-key": USER_KEY, "x-aeroscope-client": "watchOS", ...headers } });
  const operator = (method, path, body, headers = {}) =>
    app.handle({ method, path, body, query: {}, headers: { "x-aeroscope-user": "user-1", "x-aeroscope-operator-key": operatorKey, ...headers } });
  return { app, call, operator, store, published, pushed, advance: (min) => (now = new Date(now.getTime() + min * 60_000)), now: () => now };
}

test("health reports capabilities honestly", async () => {
  const { app } = setup();
  const res = await app.handle({ method: "GET", path: "/v1/health", headers: {} });
  assert.equal(res.status, 200);
  assert.equal(res.body.provenance, "demo");
  assert.equal(res.body.push, true);
  const bare = createApp({ store: new MemoryStore() });
  const health = await bare.handle({ method: "GET", path: "/v1/health", headers: {} });
  assert.equal(health.body.push, false);
  assert.equal(health.body.realtime, false);
});

test("current reading and outside coverage", async () => {
  const { app } = setup();
  const ok = await app.handle({ method: "GET", path: "/v1/air-quality/current", query: { lat: String(geo("z-lg").lat), lon: String(geo("z-lg").lon) }, headers: {} });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.reading.zoneId, "z-lg");
  assert.ok(ok.body.match.world);
  const far = await app.handle({ method: "GET", path: "/v1/air-quality/current", query: { lat: "37.33", lon: "-122.0" }, headers: {} });
  assert.equal(far.status, 404);
  assert.equal(far.body.code, "outside-coverage");
});

test("full trip: start → upcoming alert → route request → reroute → end", async () => {
  const { call, published, store, advance } = setup();
  await store.setScenarioOverride({ preset: "traffic-haze", timeIndex: 3 });
  const planned = ["z-lg", "z-ig", "z-cp", "z-ndls", "z-cc", "z-rf"];
  const start = await call("POST", "/v1/trips", {
    tripId: "trip-1", startedAt: "2026-10-11T10:00:00Z", mode: "walk", source: "live",
    origin: { geo: geo("z-lg"), simulated: false }, destinationZoneId: "z-rf", plannedZoneIds: planned,
  }, { "idempotency-key": "k1" });
  assert.equal(start.status, 201);
  assert.equal(start.body.evaluation.reading.zoneId, "z-lg");
  assert.equal(start.body.alert, null);

  advance(2);
  const moved = await call("POST", "/v1/trips/trip-1/events", { type: "location", at: "2026-10-11T10:02:00Z", location: { geo: geo("z-ig") } },
    { "idempotency-key": "k2" });
  assert.equal(moved.status, 200);
  const alert = moved.body.evaluation.alert;
  assert.equal(alert.kind, "upcoming-zone");
  assert.equal(alert.zoneId, "z-cp");
  assert.ok(published.some((e) => e.type === "trip.location" && e.zoneId === "z-ig" && e.world));
  assert.ok(published.some((e) => e.type === "alert.raised"));

  const routeReq = await call("POST", `/v1/alerts/${alert.id}/actions`, {
    action: "request-route", at: "2026-10-11T10:02:30Z", mode: "walk", currentZoneId: "z-ig", destinationZoneId: "z-rf", plannedZoneIds: planned,
  }, { "idempotency-key": "k3" });
  assert.equal(routeReq.body.alert.status, "reroute-requested");
  const alternative = routeReq.body.routeComparison.alternative;
  assert.deepEqual(alternative.zoneIds, ["z-ig", "z-yb", "z-rf"]);

  const accepted = await call("POST", "/v1/trips/trip-1/route", {
    routeId: alternative.id, choice: "alternative", zoneIds: alternative.zoneIds, alertId: alert.id, at: "2026-10-11T10:03:00Z",
  }, { "idempotency-key": "k4" });
  assert.deepEqual(accepted.body.plannedZoneIds, ["z-lg", "z-ig", "z-yb", "z-rf"]);
  assert.equal(accepted.body.alert.status, "rerouted");
  assert.ok(published.some((e) => e.type === "route.changed"));

  const status = await call("GET", "/v1/trips/trip-1");
  assert.equal(status.body.phase, "active");
  assert.equal(status.body.alerts.length, 1);
  assert.equal(status.body.lastEvaluationSource, "device");

  const ended = await call("POST", "/v1/trips/trip-1/events", { type: "end", at: "2026-10-11T10:20:00Z" }, { "idempotency-key": "k5" });
  assert.equal(ended.body.tripPhase, "ended");
  const late = await call("POST", "/v1/trips/trip-1/events", { type: "location", at: "2026-10-11T10:21:00Z", location: { geo: geo("z-yb") } });
  assert.equal(late.status, 409);
});

test("idempotency keys replay the stored response", async () => {
  const { call, published } = setup();
  const body = { tripId: "trip-2", startedAt: "2026-10-11T10:00:00Z", mode: "walk", plannedZoneIds: [] };
  const a = await call("POST", "/v1/trips", body, { "idempotency-key": "same" });
  const before = published.length;
  const b = await call("POST", "/v1/trips", body, { "idempotency-key": "same" });
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  assert.equal(b.body.replayed, true);
  assert.equal(published.length, before, "a replay has no side effects");
});

test("offline device alert is recorded under its own id and not repeated", async () => {
  const { call, store } = setup();
  await store.setScenarioOverride({ preset: "traffic-haze", timeIndex: 3 });
  await call("POST", "/v1/trips", { tripId: "trip-3", startedAt: "2026-10-11T10:00:00Z", mode: "walk", destinationZoneId: "z-rf",
    plannedZoneIds: ["z-lg", "z-ig", "z-cp", "z-ndls", "z-cc", "z-rf"] });
  const deviceAlert = { id: "dev-alert-1", tripId: "trip-3", zoneId: "z-cp", zoneName: "Connaught Place", aqi: 236, kind: "upcoming-zone",
    origin: "device", status: "active", createdAt: "2026-10-11T09:58:00Z", simulated: true };
  const res = await call("POST", "/v1/trips/trip-3/events", { type: "location", at: "2026-10-11T09:58:00Z", location: { geo: geo("z-ig") }, deviceAlert });
  assert.equal(res.status, 200);
  assert.equal(res.body.evaluation.alert, null, "already warned by the device");
  const alerts = await call("GET", "/v1/alerts");
  assert.deepEqual(alerts.body.alerts.map((a) => a.id), ["dev-alert-1"]);
  assert.equal(alerts.body.alerts[0].origin, "device");
});

test("operator simulation pushes to registered watches; direct watch requests do not", async () => {
  const { call, operator, store, pushed } = setup();
  // Connaught Place is Poor (236) and Anand Vihar Very Poor (360): the
  // simulated move is an escalation, so it alerts despite the cooldown.
  await store.setScenarioOverride({ preset: "traffic-haze", timeIndex: 3 });
  const reg = await call("PUT", "/v1/devices/watch-1", { token: "abcdef0123456789abcdef", platform: "watchOS", environment: "sandbox", bundleId: "x" });
  assert.equal(reg.body.push, true);
  await call("POST", "/v1/trips", { tripId: "trip-4", startedAt: "2026-10-11T10:00:00Z", mode: "walk", plannedZoneIds: [] });
  await call("POST", "/v1/trips/trip-4/events", { type: "location", at: "2026-10-11T10:01:00Z", location: { geo: geo("z-cp") } });
  assert.equal(pushed.length, 0, "the watch shows its own alert in-app");

  const sim = await operator("POST", "/v1/trips/trip-4/simulate", { zoneId: "z-an" });
  assert.equal(sim.status, 200);
  assert.equal(sim.body.evaluation.reading.zoneId, "z-an");
  assert.equal(pushed.length, 1);
  assert.equal(pushed[0].alert.zoneId, "z-an");
  assert.equal(pushed[0].alert.kind, "escalation");
  const status = await call("GET", "/v1/trips/trip-4");
  assert.equal(status.body.lastEvaluationSource, "operator");
});

test("validation errors", async () => {
  const { call, app } = setup();
  assert.equal((await app.handle({ method: "GET", path: "/v1/alerts", headers: {} })).status, 401);
  assert.equal((await call("POST", "/v1/trips", { tripId: "bad id!", startedAt: "x" })).status, 400);
  assert.equal((await call("GET", "/v1/trips/nope")).status, 404);
  assert.equal((await call("DELETE", "/v1/trips")).status, 405);
  assert.equal((await call("PUT", "/v1/preferences", { threshold: "Awful" })).status, 400);
  assert.equal((await call("PUT", "/v1/devices/w1", { token: "not-hex" })).status, 400);
});

test("preferences are last-writer-wins and drive evaluation", async () => {
  const { call } = setup();
  const newer = await call("PUT", "/v1/preferences", { alertsEnabled: true, threshold: "Very Poor", cooldownMinutes: 10, onlyDuringTrips: true,
    sensitiveGroup: false, lookAhead: true, travelMode: "cycle", staleAfterMinutes: 30, updatedAt: "2026-10-11T10:00:00Z" });
  assert.equal(newer.body.threshold, "Very Poor");
  const older = await call("PUT", "/v1/preferences", { alertsEnabled: true, threshold: "Moderate", updatedAt: "2026-10-11T09:00:00Z" });
  assert.equal(older.body.threshold, "Very Poor");
});

test("a user id alone is not enough: the user key is pinned on first use", async () => {
  const { app, call } = setup();
  const first = await call("GET", "/v1/alerts");
  assert.equal(first.status, 200);
  const spoof = await app.handle({ method: "GET", path: "/v1/alerts", query: {},
    headers: { "x-aeroscope-user": "user-1", "x-aeroscope-user-key": "x".repeat(48) } });
  assert.equal(spoof.status, 403);
  assert.equal(spoof.body.code, "forbidden");
  const short = await app.handle({ method: "GET", path: "/v1/alerts", query: {}, headers: { "x-aeroscope-user": "user-2", "x-aeroscope-user-key": "short" } });
  assert.equal(short.status, 401);
  const cognito = await app.handle({ method: "GET", path: "/v1/alerts", query: {}, headers: {}, authUserId: "cognito-sub-1" });
  assert.equal(cognito.status, 200, "a Cognito subject needs no user key");
});

test("operator routes need the operator key and are off without one", async () => {
  const { call, operator } = setup();
  assert.equal((await call("PUT", "/v1/scenario", { preset: "clear-morning", timeIndex: 0 })).status, 403, "user credentials are not operator credentials");
  assert.equal((await operator("PUT", "/v1/scenario", { preset: "clear-morning", timeIndex: 0 }, { "x-aeroscope-operator-key": "wrong" })).status, 403);
  assert.equal((await operator("PUT", "/v1/scenario", { preset: "clear-morning", timeIndex: 0 })).status, 200);

  const locked = setup({ operatorKey: null });
  const res = await locked.operator("PUT", "/v1/scenario", { preset: "clear-morning", timeIndex: 0 }, { "x-aeroscope-operator-key": "anything" });
  assert.equal(res.status, 403);
  assert.match(res.body.error, /disabled/);
});
