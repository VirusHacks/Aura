import { describe, expect, it } from "vitest";
import { getAqiCategory } from "../../lib/aqi";
import { distanceKm, locateGeo, locateWorld } from "../../lib/geo";
import { computeZoneReading } from "../../lib/simulation-engine";
import { DEFAULT_PREFERENCES, effectiveThresholdAqi, evaluateAlert, historyEntry } from "../functions/domain/alerts";
import { DEMO_CITY, normalizeScenario, readingsByZone, scenarioForClock, scenarioLabel, zoneReading } from "../functions/domain/city";
import { resolveLocation } from "../functions/domain/evaluate";
import { normalizeCode, newCode, parseAnswer, hashSecret, secretMatches } from "../functions/domain/pairing";
import { newTrip, recordSample, transition } from "../functions/domain/trips";
import type { ZoneReadingV1 } from "../../types/api";

const HAZE_1500 = { preset: "traffic-haze" as const, timeIndex: 3 };

describe("AQI categories (CPCB bands)", () => {
  it.each([
    [0, "Good"], [50, "Good"], [51, "Satisfactory"], [100, "Satisfactory"], [101, "Moderate"], [200, "Moderate"],
    [201, "Poor"], [300, "Poor"], [301, "Very Poor"], [400, "Very Poor"], [401, "Severe"], [500, "Severe"], [900, "Severe"],
  ])("AQI %i is %s", (aqi, category) => expect(getAqiCategory(aqi)).toBe(category));
});

describe("scenario readings", () => {
  it("match the web dashboard's engine for every zone, preset and time", () => {
    for (const preset of ["clear-morning", "traffic-haze", "winter-stagnation", "breezy-dispersal"] as const) {
      for (let t = 0; t < 8; t++) {
        for (const z of DEMO_CITY.dataset.zones) {
          const web = computeZoneReading(z, t, preset, "demo");
          const api = zoneReading(z, { preset, timeIndex: t }, "demo");
          expect(api.aqi).toBe(web.aqi);
          expect(api.pm25).toBe(web.pm25);
          expect(api.simulated).toBe(true);
        }
      }
    }
  });

  it("labels and normalises scenarios", () => {
    expect(scenarioLabel(HAZE_1500)).toBe("Urban Traffic Haze · 15:00");
    expect(normalizeScenario({ preset: "nope" as never, timeIndex: 99 })).toEqual({ preset: "traffic-haze", timeIndex: 7 });
    // 09:30 UTC is 15:00 in Delhi.
    expect(scenarioForClock("traffic-haze", new Date("2026-11-14T09:30:00Z"))).toEqual(HAZE_1500);
  });
});

describe("geography", () => {
  const zones = DEMO_CITY.dataset.zones;

  it("projects every zone anchor exactly onto its 3D position, both ways", () => {
    const p = DEMO_CITY.projection!;
    for (const z of zones) {
      expect(p.toWorld(z.geo!)).toEqual({ x: z.position[0], z: z.position[1] });
      expect(distanceKm(p.toGeo({ x: z.position[0], z: z.position[1] }), z.geo!)).toBeLessThan(0.001);
    }
  });

  it("locates GPS fixes and rejects points outside coverage", () => {
    const cc = locateGeo(zones, { lat: 28.6506, lon: 77.2303 });
    expect(cc.inside && cc.match.zoneId).toBe("z-cc");
    const mumbai = locateGeo(zones, { lat: 19.07, lon: 72.87 });
    expect(mumbai.inside).toBe(false);
  });

  it("locates dashboard points by zone and changes zone at the boundary", () => {
    const a = locateWorld(zones, { x: 2, z: -72 });
    expect(a.inside && a.match.zoneId).toBe("z-cc");
    const b = locateWorld(zones, { x: 40, z: -71 });
    expect(b.inside && b.match.zoneId).toBe("z-rf");
    expect(locateWorld(zones, { x: 2000, z: 2000 }).inside).toBe(false);
  });

  it("accepts world and zone positions only when simulated", () => {
    expect(resolveLocation(DEMO_CITY, { world: { x: 2, z: -72 }, simulated: true }).zoneId).toBe("z-cc");
    expect(() => resolveLocation(DEMO_CITY, { world: { x: 2, z: -72 }, simulated: false })).toThrow(/only for simulated/);
    expect(() => resolveLocation(DEMO_CITY, { zoneId: "z-cc", simulated: false })).toThrow(/only for simulated/);
    expect(() => resolveLocation(DEMO_CITY, { geo: { lat: 19.07, lon: 72.87 }, simulated: false })).toThrow(/Outside Delhi/);
  });
});

describe("alert rules", () => {
  const readings = readingsByZone(DEMO_CITY, HAZE_1500);
  const r = (id: string) => readings.get(id)!;
  const now = new Date("2026-11-14T09:30:00Z");
  const ctx = (reading: ZoneReadingV1, extra: Partial<Parameters<typeof evaluateAlert>[0]> = {}) => ({
    reading,
    dataAsOf: now,
    upcoming: null,
    tripPhase: "active" as const,
    history: [],
    now,
    ...extra,
  });

  it("raises when entering a zone at or above the threshold", () => {
    expect(evaluateAlert(ctx(r("z-cc")), DEFAULT_PREFERENCES)).toEqual({ raise: { kind: "entered-zone", reading: r("z-cc") } });
    expect(evaluateAlert(ctx(r("z-lg")), DEFAULT_PREFERENCES)).toEqual({ suppress: "below-threshold" });
  });

  it("warns sensitive groups one category earlier", () => {
    expect(effectiveThresholdAqi({ ...DEFAULT_PREFERENCES, sensitiveGroup: true })).toBe(101);
    expect("raise" in evaluateAlert(ctx(r("z-lg")), { ...DEFAULT_PREFERENCES, sensitiveGroup: true })).toBe(true);
  });

  it("never alerts on stale data, with alerts off, or without an active trip", () => {
    expect(evaluateAlert(ctx(r("z-cc"), { dataAsOf: new Date(now.getTime() - 31 * 60_000) }), DEFAULT_PREFERENCES)).toEqual({ suppress: "stale-data" });
    expect(evaluateAlert(ctx(r("z-cc")), { ...DEFAULT_PREFERENCES, alertsEnabled: false })).toEqual({ suppress: "disabled" });
    expect(evaluateAlert(ctx(r("z-cc"), { tripPhase: "paused" }), DEFAULT_PREFERENCES)).toEqual({ suppress: "no-active-trip" });
  });

  it("does not repeat a warning for the same zone and category", () => {
    const history = [historyEntry({ zoneId: "z-cc", aqi: 290, kind: "entered-zone", createdAt: new Date(now.getTime() - 3600_000).toISOString() })];
    expect(evaluateAlert(ctx(r("z-cc"), { history }), DEFAULT_PREFERENCES)).toEqual({ suppress: "already-warned" });
  });

  it("holds other alerts during the cooldown unless the air is worse", () => {
    const recent = [historyEntry({ zoneId: "z-cc", aqi: 290, kind: "entered-zone", createdAt: new Date(now.getTime() - 5 * 60_000).toISOString() })];
    expect(evaluateAlert(ctx(r("z-kg"), { history: recent }), DEFAULT_PREFERENCES)).toEqual({ suppress: "cooling-down" });
    const escalation = evaluateAlert(ctx(r("z-ln"), { history: recent }), DEFAULT_PREFERENCES);
    expect(escalation).toEqual({ raise: { kind: "escalation", reading: r("z-ln") } });
  });

  it("looks one zone ahead on the planned route", () => {
    expect(evaluateAlert(ctx(r("z-ig"), { upcoming: r("z-cp") }), DEFAULT_PREFERENCES)).toEqual({ raise: { kind: "upcoming-zone", reading: r("z-cp") } });
    expect(evaluateAlert(ctx(r("z-ig"), { upcoming: r("z-cp") }), { ...DEFAULT_PREFERENCES, lookAhead: false })).toEqual({ suppress: "below-threshold" });
  });
});

describe("trip state machine", () => {
  const base = newTrip({
    userId: "u",
    tripId: "t",
    source: "live",
    mode: "walk",
    startedAt: "2026-11-14T09:30:00.000Z",
    originZoneId: null,
    destinationZoneId: null,
    plannedZoneIds: [],
    isDemo: true,
    now: new Date("2026-11-14T09:30:00Z"),
  });

  it("allows only valid transitions", () => {
    const paused = transition(base, "pause", "2026-11-14T09:31:00Z");
    expect(paused.phase).toBe("paused");
    expect(() => transition(paused, "pause", "x")).toThrow(/not active/);
    expect(transition(paused, "resume", "x").phase).toBe("active");
    expect(() => transition(base, "resume", "x")).toThrow(/not paused/);
    const ended = transition(base, "end", "2026-11-14T10:00:00Z");
    expect(ended.endedAt).toBe("2026-11-14T10:00:00Z");
    expect(() => transition(ended, "end", "x")).toThrow(/already ended/);
  });

  it("accumulates time-weighted exposure and drops long gaps", () => {
    let t = recordSample(base, { at: "2026-11-14T09:30:00.000Z", zoneId: "z-cc", zoneName: "Chandni Chowk", aqi: 290, world: { x: 2, z: -72 }, simulated: true }, true).trip;
    t = recordSample(t, { at: "2026-11-14T09:32:00.000Z", zoneId: "z-rf", zoneName: "Red Fort", aqi: 251, world: { x: 45, z: -71 }, simulated: true }, true).trip;
    expect(t.exposure.knownSeconds).toBe(120);
    expect(t.exposure.secondsAtOrAbovePoor).toBe(120);
    expect(t.exposure.peakAqi).toBe(290);
    const gap = recordSample(t, { at: "2026-11-14T11:00:00.000Z", zoneId: "z-rf", zoneName: "Red Fort", aqi: 251, world: null, simulated: true }, true).trip;
    expect(gap.exposure.knownSeconds).toBe(120);
  });

  it("does not keep the position without location consent", () => {
    const t = recordSample(base, { at: "2026-11-14T09:30:00.000Z", zoneId: "z-cc", zoneName: "Chandni Chowk", aqi: 290, world: { x: 2, z: -72 }, simulated: true }, false);
    expect(t.trip.currentWorld).toBeNull();
    expect(t.trip.currentZoneId).toBe("z-cc");
  });
});

describe("pairing codes", () => {
  it("generates readable codes and normalises user input", () => {
    for (let i = 0; i < 200; i++) expect(newCode()).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
    expect(normalizeCode(" k7q-2p9 ")).toBe("K7Q2P9");
    expect(normalizeCode("K7Q2P0")).toBeNull();
    expect(normalizeCode("K7Q2")).toBeNull();
  });

  it("checks secrets by hash and parses challenge answers strictly", () => {
    const h = hashSecret("s".repeat(43));
    expect(secretMatches("s".repeat(43), h)).toBe(true);
    expect(secretMatches("t".repeat(43), h)).toBe(false);
    expect(parseAnswer(`3f2a9c1e-0000-4000-8000-000000000000.${"a".repeat(43)}`)?.pairingId).toBe("3f2a9c1e-0000-4000-8000-000000000000");
    expect(parseAnswer("nodot")).toBeNull();
    expect(parseAnswer(`id.${"a".repeat(5)}`)).toBeNull();
  });
});
