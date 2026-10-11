import { describe, expect, it } from "vitest";
import type { Evaluation, OperationResult, PollutionAlert, RouteComparison, TripStatusResponse } from "../../types/api";
import { DOMAIN_EVENTS } from "../../types/api";
import { T0, iso, makeWorld } from "./support";

type W = ReturnType<typeof makeWorld>;

async function startAtChandniChowk(w: W, tripId = "trip-1", user = w.user("alice")) {
  return w.call("POST", "/v1/trips", {
    user,
    headers: { "x-aeroscope-client": "watchOS" },
    body: { tripId, startedAt: iso(w.now()), mode: "walk", source: "live", origin: { zoneId: "z-cc", simulated: true }, destinationZoneId: "z-rf" },
  });
}

const move = (w: W, tripId: string, x: number, z: number, extra: Record<string, string> = {}) =>
  w.call("POST", `/v1/trips/${tripId}/events`, {
    headers: { "x-aeroscope-client": "web", ...extra },
    body: { type: "location", at: iso(w.now()), location: { world: { x, z }, simulated: true } },
  });

describe("authentication and ownership", () => {
  it("rejects user routes without a verified identity", async () => {
    const w = makeWorld();
    const res = await w.call("GET", "/v1/alerts", { user: null });
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: "unauthenticated" });
  });

  it("never shows one user's trip or alerts to another", async () => {
    const w = makeWorld();
    await startAtChandniChowk(w);
    const asBob = await w.call("GET", "/v1/trips/trip-1", { user: w.user("bob") });
    expect(asBob.status).toBe(404);
    const bobMoves = await w.call("POST", "/v1/trips/trip-1/events", {
      user: w.user("bob"),
      body: { type: "location", at: iso(w.now()), location: { world: { x: 45, z: -71 }, simulated: true } },
    });
    expect(bobMoves.status).toBe(404);
    expect(((await w.call("GET", "/v1/alerts", { user: w.user("bob") })).body as { alerts: unknown[] }).alerts).toHaveLength(0);
  });

  it("keeps the same trip id separate per user (no cross-tenant collisions)", async () => {
    const w = makeWorld();
    expect((await startAtChandniChowk(w, "same-id", w.user("alice"))).status).toBe(201);
    expect((await startAtChandniChowk(w, "same-id", w.user("bob"))).status).toBe(201);
    const aliceEvents = w.events.events.filter((e) => e.detail.userId === "alice").length;
    const bobEvents = w.events.events.filter((e) => e.detail.userId === "bob").length;
    expect(aliceEvents).toBeGreaterThan(0);
    expect(bobEvents).toBeGreaterThan(0);
  });
});

describe("request validation", () => {
  it.each([
    [{}, /tripId/],
    [{ tripId: "bad id!", startedAt: "2026-11-14T09:30:00Z" }, /tripId/],
    [{ tripId: "t", startedAt: "yesterday" }, /startedAt/],
    [{ tripId: "t", startedAt: "2026-11-14T09:30:00Z", origin: { world: { x: "a", z: 1 }, simulated: true } }, /world/],
    [{ tripId: "t", startedAt: "2026-11-14T09:30:00Z", destinationZoneId: "z-nowhere" }, /Unknown zone/],
  ])("rejects %j", async (body, message) => {
    const w = makeWorld();
    const res = await w.call("POST", "/v1/trips", { body });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(message);
  });

  it("rejects GPS fixes outside Delhi with outside-coverage", async () => {
    const w = makeWorld();
    await w.call("POST", "/v1/trips", { body: { tripId: "t", startedAt: iso(w.now()) } });
    const res = await w.call("POST", "/v1/trips/t/events", { body: { type: "location", at: iso(w.now()), location: { geo: { lat: 19.07, lon: 72.87 }, simulated: false } } });
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: "outside-coverage" });
  });
});

describe("live demo: dashboard moves, watch sees alerts", () => {
  it("starts at Chandni Chowk, plans the route and alerts on entry", async () => {
    const w = makeWorld();
    const res = await startAtChandniChowk(w);
    expect(res.status).toBe(201);
    const body = res.body as OperationResult & { trip: TripStatusResponse };
    expect(body.trip.currentZoneId).toBe("z-cc");
    expect(body.trip.currentLocation?.world).toEqual({ x: 2, z: -72 });
    expect(body.plannedZoneIds).toEqual(["z-cc", "z-rf"]);
    expect(body.alert).toMatchObject({ zoneId: "z-cc", kind: "entered-zone", source: "DEMO", isDemo: true, origin: "backend" });
    const types = w.events.events.map((e) => e.detailType);
    expect(types).toEqual(expect.arrayContaining([DOMAIN_EVENTS.TripStarted, DOMAIN_EVENTS.AlertCreated, DOMAIN_EVENTS.TripZoneChanged, DOMAIN_EVENTS.AirQualityThresholdCrossed]));
  });

  it("evaluates a dashboard walk and the watch picks the alert up by polling", async () => {
    const w = makeWorld();
    await w.call("POST", "/v1/trips", { body: { tripId: "t", startedAt: iso(w.now()), origin: { zoneId: "z-lg", simulated: true } } });
    w.advance(5);
    const enteredCp = await move(w, "t", 2, -14);
    const evaluation = (enteredCp.body as OperationResult).evaluation as Evaluation;
    expect(evaluation.match.zoneId).toBe("z-cp");
    expect(evaluation.alert?.zoneName).toBe("Connaught Place");

    const poll = (await w.call("GET", "/v1/trips/t", { headers: { "x-aeroscope-client": "watchOS" } })).body as TripStatusResponse;
    expect(poll.lastEvaluationSource).toBe("dashboard");
    expect(poll.lastEvaluation?.match.zoneId).toBe("z-cp");
    expect(poll.alerts.map((a) => a.zoneId)).toContain("z-cp");
    expect(poll.currentLocation).toMatchObject({ zoneId: "z-cp", simulated: true });
  });

  it("does not repeat an alert when walking around inside the same zone", async () => {
    const w = makeWorld();
    await startAtChandniChowk(w);
    w.advance(3);
    const again = await move(w, "trip-1", 4, -70);
    expect((again.body as OperationResult).alert).toBeNull();
    expect((again.body as OperationResult).evaluation?.suppression).toBe("already-warned");
    expect([...w.alerts.alerts.values()]).toHaveLength(1);
  });

  it("raises at most one alert for concurrent duplicate positions", async () => {
    const w = makeWorld();
    await w.call("POST", "/v1/trips", { body: { tripId: "t", startedAt: iso(w.now()), origin: { zoneId: "z-lg", simulated: true } } });
    w.advance(2);
    const results = await Promise.all([move(w, "t", 2, -14), move(w, "t", 2, -14), move(w, "t", 2, -14)]);
    expect(results.every((r) => r.status === 200)).toBe(true);
    const cpAlerts = [...w.alerts.alerts.values()].filter((a) => a.zoneId === "z-cp");
    expect(cpAlerts).toHaveLength(1);
    expect(w.events.events.filter((e) => e.detailType === DOMAIN_EVENTS.AlertCreated && (e.detail.envelope.payload as { alert: PollutionAlert }).alert.zoneId === "z-cp")).toHaveLength(1);
  });

  it("replays a repeated Idempotency-Key without side effects", async () => {
    const w = makeWorld();
    await w.call("POST", "/v1/trips", { body: { tripId: "t", startedAt: iso(w.now()), origin: { zoneId: "z-lg", simulated: true } } });
    const eventsBefore = w.events.events.length;
    const first = await move(w, "t", 2, -14, { "idempotency-key": "k-1" });
    const second = await move(w, "t", 2, -14, { "idempotency-key": "k-1" });
    expect(second.body).toMatchObject({ replayed: true });
    expect((second.body as OperationResult).alert?.id).toBe((first.body as OperationResult).alert?.id);
    // Only the first request produced events; the replay added none.
    expect(w.events.events.slice(eventsBefore).filter((e) => e.detailType === DOMAIN_EVENTS.TripLocationUpdated)).toHaveLength(1);
  });
});

describe("trip lifecycle", () => {
  it("pauses, resumes and ends, rejecting invalid transitions with 409", async () => {
    const w = makeWorld();
    await startAtChandniChowk(w);
    const ev = (type: string) => w.call("POST", "/v1/trips/trip-1/events", { body: { type, at: iso(w.now()) } });
    expect((await ev("resume")).status).toBe(409);
    expect((await ev("pause")).body).toMatchObject({ tripPhase: "paused" });
    expect((await move(w, "trip-1", 45, -71)).body).toMatchObject({ evaluation: { suppression: "no-active-trip" } });
    expect((await ev("resume")).body).toMatchObject({ tripPhase: "active" });
    w.advance(600);
    const ended = (await ev("end")).body as OperationResult & { trip: TripStatusResponse };
    expect(ended.tripPhase).toBe("ended");
    expect(ended.trip.summary.durationSeconds).toBe(600);
    expect(ended.trip.summary.zonesVisited).toEqual(["z-cc", "z-rf"]);
    expect((await ev("end")).status).toBe(409);
    expect((await move(w, "trip-1", 2, -72)).status).toBe(409);
  });

  it("refuses a second active trip but closes one abandoned for hours", async () => {
    const w = makeWorld();
    await startAtChandniChowk(w, "first");
    expect((await startAtChandniChowk(w, "second")).status).toBe(409);
    w.advance(7 * 3600);
    expect((await startAtChandniChowk(w, "second")).status).toBe(201);
    expect((await w.trips.get("alice", "first"))?.phase).toBe("ended");
  });

  it("exposes the active trip so a watch can adopt a trip started on the web", async () => {
    const w = makeWorld();
    expect((await w.call("GET", "/v1/trips/active")).status).toBe(404);
    await startAtChandniChowk(w);
    const active = (await w.call("GET", "/v1/trips/active")).body as TripStatusResponse;
    expect(active).toMatchObject({ tripId: "trip-1", phase: "active", destinationZoneId: "z-rf", currentZoneId: "z-cc" });
  });

  it("stores an offline watch alert under its own id and does not repeat it", async () => {
    const w = makeWorld();
    await w.call("POST", "/v1/trips", { body: { tripId: "t", startedAt: iso(w.now()) } });
    const deviceAlert = { id: "device-alert-1", zoneId: "z-cp", aqi: 236, kind: "entered-zone", createdAt: iso(w.now()) };
    const res = await w.call("POST", "/v1/trips/t/events", {
      body: { type: "location", at: iso(w.now()), location: { geo: { lat: 28.6315, lon: 77.2167 }, simulated: false }, deviceAlert },
    });
    expect((res.body as OperationResult).alert).toBeNull();
    expect((res.body as OperationResult).evaluation?.suppression).toBe("already-warned");
    const stored = await w.alerts.get("alice", "device-alert-1");
    expect(stored).toMatchObject({ origin: "device", source: "CACHED", tripId: "t" });
  });
});

describe("alerts and routes", () => {
  it("acknowledges an alert and broadcasts alert.acknowledged", async () => {
    const w = makeWorld();
    const alert = ((await startAtChandniChowk(w)).body as OperationResult).alert!;
    const res = await w.call("POST", `/v1/alerts/${alert.id}/actions`, { body: { action: "acknowledge", at: iso(w.now()) } });
    expect((res.body as { alert: PollutionAlert }).alert).toMatchObject({ status: "acknowledged" });
    expect((res.body as { alert: PollutionAlert }).alert.acknowledgedAt).toBeTruthy();
    expect(w.events.events.at(-1)?.detail.envelope.type).toBe("alert.acknowledged");
  });

  it("offers a cleaner route with a transparent score and persists the choice", async () => {
    const w = makeWorld();
    await w.call("POST", "/v1/trips", {
      body: { tripId: "t", startedAt: iso(w.now()), origin: { zoneId: "z-ig", simulated: true }, destinationZoneId: "z-rf", plannedZoneIds: ["z-ig", "z-cp", "z-ndls", "z-cc", "z-rf"] },
    });
    const alert = [...w.alerts.alerts.values()][0];
    const res = await w.call("POST", `/v1/alerts/${alert.id}/actions`, {
      body: { action: "request-route", at: iso(w.now()), currentZoneId: "z-ig", destinationZoneId: "z-rf", plannedZoneIds: ["z-ig", "z-cp", "z-ndls", "z-cc", "z-rf"] },
    });
    const cmp = (res.body as { routeComparison: RouteComparison }).routeComparison;
    expect(cmp.current.kind).toBe("planned");
    expect(cmp.alternative?.zoneIds).toEqual(["z-ig", "z-yb", "z-rf"]);
    expect(cmp.exposureReductionPercent).toBeGreaterThanOrEqual(10);
    expect(cmp.provider).toBe("demo-zone-graph");
    expect(cmp.isDemo).toBe(true);
    expect(cmp.methodology).toMatch(/not a clinical/);
    const alt = cmp.alternatives.find((a) => a.kind === "cleaner")!;
    expect(alt.routeAQIScore).toBeLessThan(cmp.alternatives[0].routeAQIScore!);
    expect(alt.world.length).toBeGreaterThan(1);

    const chosen = await w.call("POST", "/v1/trips/t/route", {
      body: { routeId: alt.routeId, choice: "alternative", zoneIds: alt.zoneIds, world: alt.world, geometry: alt.geometry, provider: alt.provider, alertId: alert.id, at: iso(w.now()) },
    });
    const trip = (chosen.body as OperationResult & { trip: TripStatusResponse }).trip;
    expect(trip.plannedZoneIds).toEqual(["z-ig", "z-yb", "z-rf"]);
    expect(trip.selectedRoute?.world).toEqual(alt.world);
    expect(trip.summary.rerouteCount).toBe(1);
    expect((await w.alerts.get("alice", alert.id))?.status).toBe("rerouted");
    expect(w.events.events.some((e) => e.detail.envelope.type === "route.selected")).toBe(true);
  });

  it("falls back to the demo provider when the routing provider fails", async () => {
    const w = makeWorld({
      routing: () => ({ id: "amazon-location", candidates: async () => { throw new Error("AccessDenied"); } }) as never,
    });
    const res = await w.call("POST", "/v1/routes/compare", { body: { fromZoneId: "z-ig", toZoneId: "z-rf", mode: "walk" } });
    expect(res.status).toBe(200);
    expect((res.body as RouteComparison).provider).toBe("demo-zone-graph");
  });
});

describe("pairing a watch", () => {
  it("approves a code for the signed-in user and reveals nothing without the secret", async () => {
    const w = makeWorld();
    const start = (await w.call("POST", "/v1/pairing", { user: null })).body as { pairingId: string; code: string; secret: string };
    expect(start.code).toMatch(/^[A-Z0-9]{6}$/);
    const status = (secret: string) => w.call("GET", `/v1/pairing/${start.pairingId}`, { user: null, headers: { "x-pairing-secret": secret } });
    expect((await status(start.secret)).body).toEqual({ status: "pending" });
    expect((await status("wrong-secret-wrong-secret")).status).toBe(404);

    const claim = await w.call("POST", "/v1/pairing/claim", { body: { code: start.code.toLowerCase() } });
    expect(claim.status).toBe(200);
    expect((await status(start.secret)).body).toMatchObject({ status: "approved", username: "alice" });
    // A code works once.
    expect((await w.call("POST", "/v1/pairing/claim", { user: w.user("mallory"), body: { code: start.code } })).status).toBe(404);
  });

  it("expires codes after ten minutes", async () => {
    const w = makeWorld();
    const start = (await w.call("POST", "/v1/pairing", { user: null })).body as { pairingId: string; code: string; secret: string };
    w.advance(601);
    expect((await w.call("POST", "/v1/pairing/claim", { body: { code: start.code } })).status).toBe(404);
    expect((await w.call("GET", `/v1/pairing/${start.pairingId}`, { user: null, headers: { "x-pairing-secret": start.secret } })).body).toEqual({ status: "expired" });
  });

  it("rate-limits code guessing per user", async () => {
    const w = makeWorld();
    const results = [];
    for (let i = 0; i < 11; i++) results.push((await w.call("POST", "/v1/pairing/claim", { body: { code: "AAAAAA" } })).status);
    expect(results.slice(0, 10).every((s) => s === 404)).toBe(true);
    expect(results[10]).toBe(429);
  });
});

describe("public data", () => {
  it("labels scenario readings as DEMO data", async () => {
    const w = makeWorld();
    const res = (await w.call("GET", "/v1/air-quality/zones", { user: null })).body as { zones: { zoneId: string; source: string; isDemo: boolean; aqi: number }[]; scenario: { label: string } };
    expect(res.zones).toHaveLength(17);
    expect(res.zones.every((z) => z.source === "DEMO" && z.isDemo)).toBe(true);
    expect(res.scenario.label).toBe("Urban Traffic Haze · 15:00");
    expect(res.zones.find((z) => z.zoneId === "z-cc")?.aqi).toBe(290);
  });

  it("follows the dashboard's saved scenario while it is recent", async () => {
    const w = makeWorld();
    w.city.scenario = { scenario: { preset: "clear-morning", timeIndex: 0 }, savedAt: iso(new Date(T0.getTime() - 3600_000)) };
    expect(((await w.call("GET", "/v1/scenario", { user: null })).body as { preset: string }).preset).toBe("clear-morning");
    w.city.scenario = { scenario: { preset: "clear-morning", timeIndex: 0 }, savedAt: iso(new Date(T0.getTime() - 13 * 3600_000)) };
    expect(((await w.call("GET", "/v1/scenario", { user: null })).body as { preset: string }).preset).toBe("traffic-haze");
  });

  it("serves client configuration without secrets", async () => {
    const w = makeWorld();
    const body = (await w.call("GET", "/v1/client-config", { user: null })).body as Record<string, unknown>;
    expect(JSON.stringify(body)).not.toMatch(/secret|password|apiKey/i);
    expect(body).toMatchObject({ cognito: { watchClientId: "watch" }, realtime: { namespace: "aeroscope" } });
  });
});
