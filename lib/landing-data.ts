/**
 * Data for the marketing landing page. Every value is derived from the same
 * deterministic scenario engine the simulation uses, so the landing page never
 * shows a number the simulation would not.
 */
import { DEMO_DATASET } from "../data/demo-zones";
import { computeReadings, TIME_STEPS } from "./simulation-engine";
import type { ScenarioPresetId, ZoneDataset, ZoneReading } from "../types/air-quality";
import type { Vec2 } from "../types/scene";

/** The watch demo runs on Urban Traffic Haze at 15:00 (see watch/README.md). */
export const DEMO_PRESET: ScenarioPresetId = "traffic-haze";
export const DEMO_TIME_INDEX = 3;

export function demoReadings(dataset: ZoneDataset = DEMO_DATASET): ZoneReading[] {
  return computeReadings(dataset, DEMO_TIME_INDEX, DEMO_PRESET);
}

/** Time step closest to the given hour of day (0–23). */
export function timeIndexForHour(hour: number): number {
  let best = 0;
  let bestGap = Infinity;
  for (const step of TIME_STEPS) {
    const raw = Math.abs(step.hour - hour);
    const gap = Math.min(raw, 24 - raw);
    if (gap < bestGap) {
      best = step.index;
      bestGap = gap;
    }
  }
  return best;
}

/** Current hour in Delhi (IST, UTC+5:30), independent of the viewer's zone. */
export function delhiHour(now = new Date()): number {
  const minutes = now.getUTCHours() * 60 + now.getUTCMinutes() + 330;
  return Math.floor((minutes % 1440) / 60);
}

export interface CitySpread {
  average: number;
  min: ZoneReading;
  max: ZoneReading;
}

export function citySpread(readings: ZoneReading[]): CitySpread {
  const sorted = [...readings].sort((a, b) => a.aqi - b.aqi);
  const average = Math.round(readings.reduce((sum, r) => sum + r.aqi, 0) / readings.length);
  return { average, min: sorted[0], max: sorted[sorted.length - 1] };
}

/**
 * The watch demo journey, Lodhi Garden → Red Fort Precinct. The fastest route
 * crosses Connaught Place; the cleaner route turns east at India Gate and
 * follows the Yamuna Riverfront.
 */
export const JOURNEY = {
  fastest: ["z-lg", "z-ig", "z-cp", "z-ndls", "z-cc", "z-rf"],
  cleaner: ["z-lg", "z-ig", "z-yb", "z-rf"],
  /** Where the alert fires and the routes diverge. */
  alertAt: "z-ig",
  /** The poor-air zone the alert warns about. */
  hotspot: "z-cp",
} as const;

export interface RouteSummary {
  zoneIds: readonly string[];
  points: Vec2[];
  /** Path length in scene units. */
  length: number;
  peakAqi: number;
  averageAqi: number;
  /** Σ segment length × mean segment AQI: the quantity the watch minimises. */
  exposure: number;
}

export function summarizeRoute(zoneIds: readonly string[], readings: ZoneReading[]): RouteSummary {
  const byId = new Map(readings.map((r) => [r.id, r]));
  const zones = zoneIds.map((id) => {
    const z = byId.get(id);
    if (!z) throw new Error(`Unknown zone ${id}`);
    return z;
  });
  let length = 0;
  let exposure = 0;
  for (let i = 1; i < zones.length; i++) {
    const [ax, az] = zones[i - 1].position;
    const [bx, bz] = zones[i].position;
    const seg = Math.hypot(bx - ax, bz - az);
    length += seg;
    exposure += seg * ((zones[i - 1].aqi + zones[i].aqi) / 2);
  }
  return {
    zoneIds,
    points: zones.map((z) => z.position),
    length,
    peakAqi: Math.max(...zones.map((z) => z.aqi)),
    averageAqi: Math.round(exposure / length),
    exposure,
  };
}

/** Exposure saved by the cleaner route, from the point where the routes diverge. */
export function rerouteSaving(readings: ZoneReading[]) {
  const from = JOURNEY.fastest.indexOf(JOURNEY.alertAt);
  const fastest = summarizeRoute(JOURNEY.fastest.slice(from), readings);
  const cleaner = summarizeRoute(JOURNEY.cleaner.slice(JOURNEY.cleaner.indexOf(JOURNEY.alertAt)), readings);
  return {
    fastest,
    cleaner,
    percent: Math.round((1 - cleaner.exposure / fastest.exposure) * 100),
  };
}
