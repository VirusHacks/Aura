import { describe, expect, it } from "vitest";
import { DEMO_DATASET } from "../data/demo-zones";
import { aqiFromConcentrations, getAqiCategory } from "./aqi";
import { SCENARIO_PRESETS, TIME_STEPS, computeReadings, computeTrend, summarize } from "./simulation-engine";

describe("simulation engine", () => {
  it("has at least 12 zones across all five regions", () => {
    expect(DEMO_DATASET.zones.length).toBeGreaterThanOrEqual(12);
    expect(new Set(DEMO_DATASET.zones.map((z) => z.region)).size).toBe(5);
  });

  it("produces internally consistent readings for every step and preset", () => {
    for (const preset of SCENARIO_PRESETS) {
      for (const step of TIME_STEPS) {
        const readings = computeReadings(DEMO_DATASET, step.index, preset.id);
        for (const r of readings) {
          expect(r.aqi).toBeGreaterThanOrEqual(0);
          expect(r.aqi).toBeLessThanOrEqual(500);
          expect(r.category).toBe(getAqiCategory(r.aqi));
          // AQI shown must equal the max sub-index of the PM values shown.
          expect(aqiFromConcentrations(r.pm25, r.pm10)).toBeGreaterThanOrEqual(r.aqi);
          expect(aqiFromConcentrations(r.pm25, r.pm10) - r.aqi).toBeLessThanOrEqual(3);
          expect(r.provenance).toBe("demo");
          expect(r.simulated).toBe(true);
        }
      }
    }
  });

  it("is deterministic", () => {
    const a = computeReadings(DEMO_DATASET, 4, "winter-stagnation");
    const b = computeReadings(DEMO_DATASET, 4, "winter-stagnation");
    expect(a).toEqual(b);
  });

  it("summary derives from the same readings", () => {
    const readings = computeReadings(DEMO_DATASET, 3, "traffic-haze");
    const s = summarize(readings);
    const avg = Math.round(readings.reduce((acc, r) => acc + r.aqi, 0) / readings.length);
    expect(s.avgAqi).toBe(avg);
    expect(s.highCount).toBe(readings.filter((r) => r.aqi > 200).length);
  });

  it("clear morning is cleaner than winter stagnation", () => {
    const clean = summarize(computeReadings(DEMO_DATASET, 1, "clear-morning"));
    const dirty = summarize(computeReadings(DEMO_DATASET, 1, "winter-stagnation"));
    expect(clean.avgAqi).toBeLessThan(dirty.avgAqi);
  });

  it("trend matches point readings", () => {
    const trend = computeTrend(DEMO_DATASET, "traffic-haze");
    const at5 = computeReadings(DEMO_DATASET, 5, "traffic-haze");
    expect(trend[5]["z-cp"]).toBe(at5.find((r) => r.id === "z-cp")!.aqi);
  });
});
