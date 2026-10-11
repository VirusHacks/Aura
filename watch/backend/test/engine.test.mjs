import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { BUNDLED, bundledDataset } from "../src/city.mjs";
import {
  aqiCategory,
  clampAqi,
  concentrationForIndex,
  effectiveThresholdAqi,
  evaluateAlert,
  locate,
  makePlanner,
  makeProjection,
  readingsByZone,
  scenarioForClock,
  subIndex,
  zoneReading,
  DEFAULT_PREFERENCES,
} from "../src/engine.mjs";

const root = new URL("../../", import.meta.url);
const dataset = bundledDataset();
const demo = { preset: "traffic-haze", timeIndex: 3 };

test("backend dataset is byte-identical to the watch app's copy", () => {
  const swift = readFileSync(new URL("AeroscopeKit/Sources/AeroscopeKit/Resources/delhi-zones.json", root), "utf8");
  const backend = readFileSync(new URL("backend/src/data/delhi-zones.json", root), "utf8");
  assert.equal(backend, swift);
});

test("zone baselines equal the web app's DEMO_ZONES", async (t) => {
  let web;
  try {
    // Type-only imports are erased, so Node can load the TS data file directly.
    web = await import(new URL("../data/demo-zones.ts", root).href);
  } catch (err) {
    t.skip(`web data not importable here (${err.code ?? err.message}); run with --experimental-strip-types`);
    return;
  }
  const strip = ({ geo, ...rest }) => rest;
  assert.deepEqual(BUNDLED.zones.map(strip), web.DEMO_ZONES);
  assert.equal(BUNDLED.baselineTime, web.DEMO_DATASET.baselineTime);
});

test("every scenario reading matches the web engine (544 golden rows)", () => {
  const csv = readFileSync(new URL("AeroscopeKit/Tests/AeroscopeKitTests/Fixtures/web-engine-golden.csv", root), "utf8").trim().split("\n");
  assert.equal(csv.length, 544);
  for (const row of csv) {
    const [id, preset, t, aqi, pm25, pm10, temp, wind] = row.split(",");
    const zone = dataset.zones.find((z) => z.id === id);
    const r = zoneReading(zone, { preset, timeIndex: Number(t) }, "demo");
    assert.deepEqual([r.aqi, r.pm25, r.pm10, r.temperature, r.windSpeed], [aqi, pm25, pm10, temp, wind].map(Number), row);
  }
});

test("AQI bands and sub-indices", () => {
  const cases = [[0, "Good"], [50, "Good"], [51, "Satisfactory"], [100, "Satisfactory"], [101, "Moderate"], [200, "Moderate"],
    [201, "Poor"], [300, "Poor"], [301, "Very Poor"], [400, "Very Poor"], [401, "Severe"], [500, "Severe"], [-5, "Good"], [900, "Severe"]];
  for (const [aqi, category] of cases) assert.equal(aqiCategory(aqi), category, String(aqi));
  assert.equal(clampAqi(50.5), 51);
  assert.equal(clampAqi(NaN), 0);
  assert.equal(subIndex("PM2.5", 45), 75);
  assert.equal(concentrationForIndex("PM10", 412), 440);
});

test("scenario follows the IST clock", () => {
  assert.equal(scenarioForClock("traffic-haze", new Date("2026-10-11T08:10:00Z")).timeIndex, 2);
  assert.equal(scenarioForClock("traffic-haze", new Date("2026-10-11T17:30:00Z")).timeIndex, 6);
});

test("locate and project", () => {
  for (const zone of dataset.zones) {
    const r = locate(dataset, zone.geo);
    assert.equal(r.inside, true);
    assert.equal(r.match.zoneId, zone.id);
  }
  assert.equal(locate(dataset, { lat: 37.33, lon: -122.0 }).inside, false);
  const project = makeProjection(dataset);
  const east = project({ lat: 28.63, lon: 77.3 });
  const west = project({ lat: 28.63, lon: 77.13 });
  assert.ok(east.x > west.x);
});

test("cleaner route via Yamuna Riverfront (same as Swift)", () => {
  const aqi = Object.fromEntries(Object.entries(readingsByZone(dataset, demo)).map(([k, r]) => [k, r.aqi]));
  const planner = makePlanner(dataset, aqi);
  assert.deepEqual(planner.path("z-ig", "z-rf", "fastest"), ["z-ig", "z-cp", "z-ndls", "z-cc", "z-rf"]);
  const cmp = planner.compare("z-ig", "z-rf", "walk", [], null, new Date(0));
  assert.deepEqual(cmp.alternative.zoneIds, ["z-ig", "z-yb", "z-rf"]);
  assert.ok(cmp.exposureReductionPercent >= 10);
  assert.equal(planner.compare("z-yb", "z-rf", "walk", [], null, new Date(0)).alternative, null);
  const planned = planner.compare("z-ig", "z-rf", "walk", ["z-lg", "z-ig", "z-cp", "z-ndls", "z-cc", "z-rf"], null, new Date(0));
  assert.equal(planned.current.kind, "planned");
});

test("alert rules mirror AlertEvaluator.swift", () => {
  const now = new Date("2026-10-11T10:00:00Z");
  const r = (zoneId, aqi) => ({ zoneId, zoneName: zoneId, aqi });
  const ctx = (reading, extra = {}) => ({ reading, dataAsOf: now, upcoming: null, tripPhase: "active", history: [], now, ...extra });
  const ago = (min) => new Date(now - min * 60_000).toISOString();
  const prefs = { ...DEFAULT_PREFERENCES };

  assert.deepEqual(evaluateAlert(ctx(r("cp", 201)), prefs), { raise: { kind: "entered-zone", reading: r("cp", 201) } });
  assert.deepEqual(evaluateAlert(ctx(r("cp", 200)), prefs), { suppress: "below-threshold" });
  assert.deepEqual(evaluateAlert(ctx(r("cp", 450), { tripPhase: "paused" }), prefs), { suppress: "no-active-trip" });
  assert.deepEqual(evaluateAlert(ctx(r("cp", 450), { dataAsOf: new Date(now - 31 * 60_000) }), prefs), { suppress: "stale-data" });
  assert.deepEqual(evaluateAlert(ctx(r("cp", 240), { history: [{ zoneId: "cp", category: "Poor", createdAt: ago(60) }] }), prefs),
    { suppress: "already-warned" });
  assert.deepEqual(evaluateAlert(ctx(r("nd", 262), { history: [{ zoneId: "cp", category: "Poor", createdAt: ago(5) }] }), prefs),
    { suppress: "cooling-down" });
  assert.deepEqual(evaluateAlert(ctx(r("an", 360), { history: [{ zoneId: "cp", category: "Poor", createdAt: ago(2) }] }), prefs),
    { raise: { kind: "escalation", reading: r("an", 360) } });
  assert.deepEqual(evaluateAlert(ctx(r("ig", 185), { upcoming: r("cp", 236) }), prefs), { raise: { kind: "upcoming-zone", reading: r("cp", 236) } });
  assert.equal(effectiveThresholdAqi({ ...prefs, sensitiveGroup: true }), 101);
  assert.equal(effectiveThresholdAqi({ ...prefs, threshold: "Satisfactory", sensitiveGroup: true }), 51);
});
