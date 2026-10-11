import { describe, expect, it } from "vitest";
import {
  AQI_BANDS,
  aqiFromConcentrations,
  clampAqi,
  concentrationForIndex,
  getAqiBand,
  getAqiCategory,
  isHighPollution,
  subIndex,
} from "./aqi";

describe("Indian AQI classification", () => {
  it.each([
    [0, "Good"],
    [50, "Good"],
    [51, "Satisfactory"],
    [100, "Satisfactory"],
    [101, "Moderate"],
    [200, "Moderate"],
    [201, "Poor"],
    [300, "Poor"],
    [301, "Very Poor"],
    [400, "Very Poor"],
    [401, "Severe"],
    [500, "Severe"],
  ] as const)("AQI %i is %s", (aqi, category) => {
    expect(getAqiCategory(aqi)).toBe(category);
  });

  it("clamps out-of-range and non-finite values", () => {
    expect(clampAqi(-20)).toBe(0);
    expect(clampAqi(900)).toBe(500);
    expect(clampAqi(Number.NaN)).toBe(0);
    expect(getAqiCategory(900)).toBe("Severe");
  });

  it("bands are contiguous and colours are unique", () => {
    for (let i = 1; i < AQI_BANDS.length; i++) {
      expect(AQI_BANDS[i].min).toBe(AQI_BANDS[i - 1].max + 1);
    }
    expect(new Set(AQI_BANDS.map((b) => b.color)).size).toBe(AQI_BANDS.length);
  });

  it("flags Poor and worse as high pollution", () => {
    expect(isHighPollution(200)).toBe(false);
    expect(isHighPollution(201)).toBe(true);
    expect(getAqiBand(201).category).toBe("Poor");
  });
});

describe("PM sub-indices", () => {
  it("matches CPCB breakpoints at band edges", () => {
    expect(subIndex("PM2.5", 30)).toBe(50);
    expect(subIndex("PM2.5", 60)).toBe(100);
    expect(subIndex("PM2.5", 90)).toBe(200);
    expect(subIndex("PM2.5", 120)).toBe(300);
    expect(subIndex("PM2.5", 250)).toBe(400);
    expect(subIndex("PM10", 100)).toBe(100);
    expect(subIndex("PM10", 250)).toBe(200);
    expect(subIndex("PM10", 350)).toBe(300);
  });

  it("concentrationForIndex round-trips for every AQI value", () => {
    for (let aqi = 0; aqi <= 500; aqi++) {
      for (const p of ["PM2.5", "PM10"] as const) {
        const c = concentrationForIndex(p, aqi);
        expect(subIndex(p, c)).toBeGreaterThanOrEqual(aqi);
        expect(subIndex(p, c) - aqi).toBeLessThanOrEqual(3);
      }
    }
  });

  it("overall AQI is the max sub-index", () => {
    expect(aqiFromConcentrations(95, 120)).toBe(subIndex("PM2.5", 95));
    expect(aqiFromConcentrations(40, 300)).toBe(subIndex("PM10", 300));
  });
});
