import { describe, expect, it, vi } from "vitest";
import type { CalculateRoutesCommand } from "@aws-sdk/client-geo-routes";
import type { DomainEventDetail, PollutionAlert } from "../../types/api";
import { buildAlert, DEFAULT_PREFERENCES } from "../functions/domain/alerts";
import { DEMO_CITY, readingsByZone } from "../functions/domain/city";
import { hashSecret } from "../functions/domain/pairing";
import { AmazonLocationRoutingProvider } from "../functions/domain/routing/amazon-location";
import { scoreRoute } from "../functions/domain/routing/scoring";
import { makeVerifier } from "../functions/handlers/auth-challenge";
import { makeNotifier } from "../functions/handlers/notifier";
import { makeRealtimeHandler } from "../functions/handlers/realtime-publisher";
import { MemoryAlertsRepo, MemoryPairingRepo, MemoryUsersRepo } from "../functions/repo/memory";
import type { DeviceRecord } from "../functions/repo/types";
import { apnsPayload, type PushSender } from "../functions/services/push";
import { userChannel } from "../functions/services/realtime";
import "./support";

const readings = readingsByZone(DEMO_CITY, { preset: "traffic-haze", timeIndex: 3 });
const now = new Date("2026-11-14T09:30:00Z");
const alert: PollutionAlert = buildAlert({
  id: "alert-1",
  userId: "alice",
  tripId: "trip-1",
  kind: "entered-zone",
  reading: readings.get("z-cc")!,
  prefs: DEFAULT_PREFERENCES,
  scenarioLabel: "Urban Traffic Haze · 15:00",
  dataAsOf: now.toISOString(),
  now,
  source: "dashboard",
});
const alertEvent = (detail: Partial<DomainEventDetail<{ alert: PollutionAlert }>> = {}) => ({
  "detail-type": "AeroScope.AlertCreated",
  detail: {
    userId: "alice",
    envelope: { eventId: "e1", type: "alert.created", schemaVersion: 1, occurredAt: now.toISOString(), correlationId: "c1", payload: { alert } },
    ...detail,
  },
}) as never;

const device = (over: Partial<DeviceRecord> = {}): DeviceRecord => ({
  userId: "alice",
  deviceId: "watch-1",
  platform: "watchOS",
  environment: "sandbox",
  bundleId: "com.example.watchkitapp",
  token: "ab".repeat(32),
  endpointArn: "arn:aws:sns:us-east-1:123456789012:endpoint/APNS_SANDBOX/aeroscope/abc",
  tokenStatus: "active",
  updatedAt: now.toISOString(),
  ...over,
});

describe("notifier", () => {
  it("sends once per alert and device even if the event is delivered twice", async () => {
    const users = new MemoryUsersRepo();
    const alerts = new MemoryAlertsRepo();
    await users.putDevice(device());
    const push: PushSender = { ensureEndpoint: vi.fn(), send: vi.fn(async () => ({ ok: true as const, messageId: "m1" })) };
    const notify = makeNotifier({ users, alerts, push });
    expect(await notify(alertEvent())).toEqual({ sent: 1 });
    expect(await notify(alertEvent())).toEqual({ sent: 0 });
    expect(push.send).toHaveBeenCalledTimes(1);
    expect([...alerts.deliveries.values()][0]).toEqual({ outcome: "sent", detail: "m1" });
  });

  it("marks endpoints APNs disabled as invalid and records the failure", async () => {
    const users = new MemoryUsersRepo();
    const alerts = new MemoryAlertsRepo();
    await users.putDevice(device());
    const push: PushSender = { ensureEndpoint: vi.fn(), send: vi.fn(async () => ({ ok: false as const, disabled: true, reason: "EndpointDisabledException" })) };
    await makeNotifier({ users, alerts, push })(alertEvent());
    expect((await users.listDevices("alice"))[0].tokenStatus).toBe("invalid");
    expect([...alerts.deliveries.values()][0].outcome).toBe("endpoint-disabled");
  });

  it("records push-not-configured and respects alerts-off preferences", async () => {
    const users = new MemoryUsersRepo();
    const alerts = new MemoryAlertsRepo();
    await users.putDevice(device({ tokenStatus: "push-not-configured", endpointArn: null }));
    await makeNotifier({ users, alerts, push: null })(alertEvent());
    expect([...alerts.deliveries.values()][0].outcome).toBe("push-not-configured");

    const users2 = new MemoryUsersRepo();
    const alerts2 = new MemoryAlertsRepo();
    await users2.putDevice(device());
    await users2.putPreferences("alice", { ...DEFAULT_PREFERENCES, alertsEnabled: false, updatedAt: now.toISOString() });
    const push: PushSender = { ensureEndpoint: vi.fn(), send: vi.fn() };
    await makeNotifier({ users: users2, alerts: alerts2, push })(alertEvent());
    expect(push.send).not.toHaveBeenCalled();
  });

  it("puts no coordinates in the push text", () => {
    const text = JSON.stringify(apnsPayload(alert).aps);
    expect(text).toContain("Chandni Chowk · AQI 290 · DEMO");
    expect(text).not.toMatch(/lat|lon|28\.\d|77\.\d/);
  });
});

describe("real-time publisher", () => {
  it("publishes the envelope to the owner's channel only", async () => {
    const publish = vi.fn(async () => {});
    await makeRealtimeHandler({ publish })(alertEvent());
    expect(publish).toHaveBeenCalledWith("alice", [expect.objectContaining({ eventId: "e1", type: "alert.created" })]);
  });

  it("throws on failure so EventBridge retries and then dead-letters", async () => {
    await expect(makeRealtimeHandler({ publish: async () => { throw new Error("HTTP 500"); } })(alertEvent())).rejects.toThrow("HTTP 500");
  });

  it("refuses channel names that could widen a subscription", () => {
    expect(userChannel("aeroscope", "1f9a-uuid-like")).toBe("/aeroscope/users/1f9a-uuid-like");
    expect(() => userChannel("aeroscope", "*")).toThrow();
    expect(() => userChannel("aeroscope", "a/b")).toThrow();
  });
});

describe("watch sign-in (VerifyAuthChallenge)", () => {
  async function setup(status: "pending" | "approved" = "approved") {
    const repo = new MemoryPairingRepo();
    const secret = "s".repeat(43);
    await repo.create({ pairingId: "11111111-2222-4333-8444-555555555555", code: "K7Q2P9", secretHash: hashSecret(secret), status: "pending", expiresAt: Math.floor(now.getTime() / 1000) + 600, createdAt: now.toISOString() });
    if (status === "approved") await repo.approve("11111111-2222-4333-8444-555555555555", { userId: "alice-sub", username: "alice-sub" }, Math.floor(now.getTime() / 1000));
    const verify = makeVerifier(repo, () => now);
    const event = (answer: string, userName = "alice-sub") => ({ userName, request: { challengeAnswer: answer }, response: {} }) as never as Parameters<typeof verify>[0];
    return { verify, event, secret };
  }

  it("accepts the right secret for the approving user exactly once", async () => {
    const { verify, event, secret } = await setup();
    const answer = `11111111-2222-4333-8444-555555555555.${secret}`;
    expect((await verify(event(answer))).response.answerCorrect).toBe(true);
    expect((await verify(event(answer))).response.answerCorrect).toBe(false);
  });

  it("rejects a wrong secret, another user, or an unapproved pairing", async () => {
    const { verify, event, secret } = await setup();
    expect((await verify(event(`11111111-2222-4333-8444-555555555555.${"t".repeat(43)}`))).response.answerCorrect).toBe(false);
    expect((await verify(event(`11111111-2222-4333-8444-555555555555.${secret}`, "mallory"))).response.answerCorrect).toBe(false);
    const pending = await setup("pending");
    expect((await pending.verify(pending.event(`11111111-2222-4333-8444-555555555555.${pending.secret}`))).response.answerCorrect).toBe(false);
  });
});

describe("Amazon Location provider and scoring", () => {
  it("maps CalculateRoutes output to scored candidates", async () => {
    const cc = DEMO_CITY.byId.get("z-cc")!.geo!;
    const rf = DEMO_CITY.byId.get("z-rf")!.geo!;
    const sent: CalculateRoutesCommand[] = [];
    const client = {
      send: async (cmd: CalculateRoutesCommand) => {
        sent.push(cmd);
        return {
          Routes: [
            { Legs: [{ Geometry: { LineString: [[cc.lon, cc.lat], [rf.lon, rf.lat]] } }], Summary: { Distance: 1500, Duration: 1200 } },
            { Legs: [{ Geometry: { LineString: [[cc.lon, cc.lat], [77.25, 28.66], [rf.lon, rf.lat]] } }], Summary: { Distance: 2600, Duration: 2100 } },
          ],
        } as never;
      },
    };
    const provider = new AmazonLocationRoutingProvider(client);
    const candidates = await provider.candidates({ fromZoneId: "z-cc", toZoneId: "z-rf", origin: cc, destination: rf, mode: "walk", plannedZoneIds: [] });
    expect(sent[0].input).toMatchObject({ TravelMode: "Pedestrian", Origin: [cc.lon, cc.lat], LegGeometryFormat: "Simple", MaxAlternatives: 2 });
    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toMatchObject({ provider: "amazon-location", distanceMeters: 1500, durationSeconds: 1200, isDemo: false });
    const scored = scoreRoute(candidates[0], DEMO_CITY, readings, 201);
    expect(scored.zoneIds[0]).toBe("z-cc");
    expect(scored.zoneIds.at(-1)).toBe("z-rf");
    expect(scored.routeAQIScore).toBeGreaterThan(250);
    expect(scored.zoneSummaries.reduce((s, z) => s + z.seconds, 0)).toBeCloseTo(1200, -1);
  });

  it("reports stretches outside every zone as unknown instead of guessing", () => {
    const far = scoreRoute(
      { routeId: "x", kind: "fastest", provider: "amazon-location", geometry: [[77.2303, 28.6506], [77.6, 28.9]], distanceMeters: 45000, durationSeconds: 36000, isDemo: false },
      DEMO_CITY,
      readings,
      201,
    );
    expect(far.unknownSeconds).toBeGreaterThan(far.estimatedDurationSeconds / 2);
    expect(far.routeAQIScore).not.toBeNull();
  });
});
