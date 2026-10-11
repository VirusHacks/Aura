import { describe, expect, it } from "vitest";
import { citySpread, delhiHour, demoReadings, JOURNEY, rerouteSaving, summarizeRoute, timeIndexForHour } from "./landing-data";

describe("landing data", () => {
  const readings = demoReadings();

  it("matches the watch demo alert: Connaught Place is Poor at 15:00", () => {
    const cp = readings.find((r) => r.id === JOURNEY.hotspot);
    expect(cp?.aqi).toBe(236);
    expect(cp?.category).toBe("Poor");
  });

  it("finds a cleaner route with lower exposure and a lower peak", () => {
    const { fastest, cleaner, percent } = rerouteSaving(readings);
    expect(cleaner.exposure).toBeLessThan(fastest.exposure);
    expect(cleaner.peakAqi).toBeLessThan(fastest.peakAqi);
    expect(percent).toBeGreaterThan(0);
  });

  it("summarises a route through its zones", () => {
    const route = summarizeRoute(["z-lg", "z-ig"], readings);
    expect(route.points).toHaveLength(2);
    expect(route.length).toBeGreaterThan(0);
    expect(() => summarizeRoute(["z-nope"], readings)).toThrow();
  });

  it("reports the spread across neighbourhoods", () => {
    const spread = citySpread(readings);
    expect(spread.min.aqi).toBeLessThan(spread.average);
    expect(spread.max.aqi).toBeGreaterThan(spread.average);
  });

  it("maps clock hours onto the nearest scenario step", () => {
    expect(timeIndexForHour(15)).toBe(3);
    expect(timeIndexForHour(23)).toBe(6);
    expect(timeIndexForHour(2)).toBe(7);
  });

  it("converts UTC to Delhi time", () => {
    expect(delhiHour(new Date(Date.UTC(2026, 0, 1, 20, 0)))).toBe(1);
    expect(delhiHour(new Date(Date.UTC(2026, 0, 1, 9, 29)))).toBe(14);
  });
});
