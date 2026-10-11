/**
 * Deterministic, illustrative scenario model.
 *
 * Readings are derived from each zone's baseline with transparent multipliers
 * for time of day (traffic + boundary-layer mixing), the atmosphere preset and
 * wind dilution. It is a teaching model for the visualisation — not an
 * atmospheric dispersion model and not a forecast.
 */
import { clampAqi, concentrationForIndex, getAqiCategory, isHighPollution } from "./aqi";
import type {
  PollutionSource,
  RegionId,
  ScenarioPreset,
  ScenarioPresetId,
  SourceCategory,
  SourceReading,
  TimeStep,
  ZoneBaseline,
  ZoneDataset,
  ZoneReading,
} from "../types/air-quality";

export const TIME_STEPS: readonly TimeStep[] = [
  { index: 0, hour: 6, label: "06:00", period: "Morning", traffic: 0.7, mixing: 1.2, temperatureOffset: -4, windFactor: 0.7 },
  { index: 1, hour: 9, label: "09:00", period: "Morning", traffic: 1.25, mixing: 1.08, temperatureOffset: -1, windFactor: 0.9 },
  { index: 2, hour: 12, label: "12:00", period: "Afternoon", traffic: 0.85, mixing: 0.82, temperatureOffset: 3, windFactor: 1.15 },
  { index: 3, hour: 15, label: "15:00", period: "Afternoon", traffic: 0.9, mixing: 0.8, temperatureOffset: 4, windFactor: 1.2 },
  { index: 4, hour: 18, label: "18:00", period: "Evening", traffic: 1.35, mixing: 1.0, temperatureOffset: 1, windFactor: 0.9 },
  { index: 5, hour: 21, label: "21:00", period: "Evening", traffic: 1.0, mixing: 1.18, temperatureOffset: -2, windFactor: 0.7 },
  { index: 6, hour: 0, label: "00:00", period: "Night", traffic: 0.45, mixing: 1.28, temperatureOffset: -5, windFactor: 0.6 },
  { index: 7, hour: 3, label: "03:00", period: "Night", traffic: 0.3, mixing: 1.32, temperatureOffset: -6, windFactor: 0.55 },
];

/** Small deterministic veer of wind direction through the day (degrees). */
const WIND_VEER = [-12, -6, 0, 6, 10, 4, -4, -10];

export const SCENARIO_PRESETS: readonly ScenarioPreset[] = [
  {
    id: "clear-morning",
    label: "Clear Morning",
    description: "Post-rain air with steady north-westerlies. Loads well below baseline.",
    load: 0.42,
    trafficBoost: 0.9,
    windSpeed: 3.6,
    windFrom: 300,
    temperatureOffset: 2,
    haze: 0.05,
  },
  {
    id: "traffic-haze",
    label: "Urban Traffic Haze",
    description: "Typical weekday: baseline loads with traffic share amplified by congestion.",
    load: 1,
    trafficBoost: 1.35,
    windSpeed: 2.2,
    windFrom: 315,
    temperatureOffset: 0,
    haze: 0.35,
  },
  {
    id: "winter-stagnation",
    label: "Winter Stagnation",
    description: "Cold, calm air under a low inversion traps emissions near the ground.",
    load: 1.38,
    trafficBoost: 1.1,
    windSpeed: 0.9,
    windFrom: 330,
    temperatureOffset: -6,
    haze: 0.7,
  },
  {
    id: "breezy-dispersal",
    label: "Breezy Dispersal",
    description: "Strong westerly winds ventilate the city and carry plumes eastward.",
    load: 0.6,
    trafficBoost: 1,
    windSpeed: 6.5,
    windFrom: 285,
    temperatureOffset: 1,
    haze: 0.12,
  },
];

export const PRESET_BY_ID: Record<ScenarioPresetId, ScenarioPreset> = Object.fromEntries(
  SCENARIO_PRESETS.map((p) => [p.id, p]),
) as Record<ScenarioPresetId, ScenarioPreset>;

const REFERENCE_WIND = 2.5;
const SCENARIO_DATE = "2026-11-14";

export function scenarioTimestamp(step: TimeStep): string {
  const hh = String(step.hour).padStart(2, "0");
  return `${SCENARIO_DATE}T${hh}:00:00+05:30`;
}

export interface ScenarioConditions {
  windSpeed: number;
  windFrom: number;
  temperatureOffset: number;
  haze: number;
  trafficLevel: number;
}

export function scenarioConditions(timeIndex: number, presetId: ScenarioPresetId): ScenarioConditions {
  const step = TIME_STEPS[timeIndex] ?? TIME_STEPS[0];
  const preset = PRESET_BY_ID[presetId];
  const windSpeed = Math.round(preset.windSpeed * step.windFactor * 10) / 10;
  const windFrom = (preset.windFrom + WIND_VEER[step.index] + 360) % 360;
  return {
    windSpeed,
    windFrom,
    temperatureOffset: step.temperatureOffset + preset.temperatureOffset,
    haze: Math.min(1, preset.haze * step.mixing),
    trafficLevel: step.traffic * preset.trafficBoost,
  };
}

/** The scenario multiplier applied to a zone's baseline AQI. Exported for transparency/tests. */
export function scenarioMultiplier(zone: Pick<ZoneBaseline, "trafficShare">, timeIndex: number, presetId: ScenarioPresetId): number {
  const step = TIME_STEPS[timeIndex] ?? TIME_STEPS[0];
  const preset = PRESET_BY_ID[presetId];
  const cond = scenarioConditions(timeIndex, presetId);
  const traffic = 1 - zone.trafficShare + zone.trafficShare * step.traffic * preset.trafficBoost;
  const dilution = Math.pow(REFERENCE_WIND / Math.max(0.3, cond.windSpeed), 0.35);
  return preset.load * step.mixing * traffic * dilution;
}

export function computeZoneReading(
  zone: ZoneBaseline,
  timeIndex: number,
  presetId: ScenarioPresetId,
  provenance: ZoneDataset["provenance"],
): ZoneReading {
  const step = TIME_STEPS[timeIndex] ?? TIME_STEPS[0];
  const cond = scenarioConditions(timeIndex, presetId);
  const aqi = Math.max(12, clampAqi(zone.baseAqi * scenarioMultiplier(zone, timeIndex, presetId)));
  // The dominant pollutant sets the AQI; the other is held at a lower sub-index
  // so that AQI = max(sub-indices) remains exactly consistent.
  const secondaryIndex = Math.round(aqi * 0.82);
  const pm25 =
    zone.dominant === "PM2.5"
      ? concentrationForIndex("PM2.5", aqi)
      : concentrationForIndex("PM2.5", secondaryIndex);
  const pm10 =
    zone.dominant === "PM10"
      ? concentrationForIndex("PM10", aqi)
      : concentrationForIndex("PM10", secondaryIndex);

  return {
    id: zone.id,
    name: zone.name,
    region: zone.region,
    position: zone.position,
    radius: zone.radius,
    aqi,
    category: getAqiCategory(aqi),
    pm25,
    pm10,
    dominant: zone.dominant,
    temperature: Math.round(zone.baseTemperature + cond.temperatureOffset),
    windSpeed: cond.windSpeed,
    windFrom: cond.windFrom,
    sources: zone.sources,
    timestamp: scenarioTimestamp(step),
    provenance,
    // Every reading derived through the scenario model is simulated, even when
    // the baseline came from a verified provider.
    simulated: true,
  };
}

export function computeReadings(dataset: ZoneDataset, timeIndex: number, presetId: ScenarioPresetId): ZoneReading[] {
  return dataset.zones.map((z) => computeZoneReading(z, timeIndex, presetId, dataset.provenance));
}

export function computeSourceReadings(
  sources: PollutionSource[],
  timeIndex: number,
  presetId: ScenarioPresetId,
): SourceReading[] {
  const step = TIME_STEPS[timeIndex] ?? TIME_STEPS[0];
  const preset = PRESET_BY_ID[presetId];
  const categoryFactor = (c: SourceCategory) => {
    switch (c) {
      case "traffic":
        return step.traffic * preset.trafficBoost;
      case "construction":
        return step.hour >= 8 && step.hour <= 19 ? 1 : 0.2;
      case "commercial":
        return step.hour >= 9 && step.hour <= 22 ? 1 : 0.35;
      case "industrial":
        return 0.9;
      case "waste-burning":
        return step.hour >= 18 || step.hour <= 6 ? 1.2 : 0.6;
    }
  };
  return sources.map((s) => ({
    ...s,
    activity: Math.min(1, Math.round(s.baseActivity * categoryFactor(s.category) * 100) / 100),
  }));
}

export interface CitySummary {
  zoneCount: number;
  avgAqi: number;
  avgPm25: number;
  highCount: number;
  worst: ZoneReading | null;
  best: ZoneReading | null;
  regionAverages: { region: RegionId; avgAqi: number; zoneCount: number }[];
}

export function summarize(readings: ZoneReading[]): CitySummary {
  if (readings.length === 0) {
    return { zoneCount: 0, avgAqi: 0, avgPm25: 0, highCount: 0, worst: null, best: null, regionAverages: [] };
  }
  const sum = (f: (r: ZoneReading) => number, rs = readings) => rs.reduce((a, r) => a + f(r), 0);
  const sorted = [...readings].sort((a, b) => b.aqi - a.aqi);
  const regions: RegionId[] = ["central", "old", "east", "south", "industrial"];
  return {
    zoneCount: readings.length,
    avgAqi: Math.round(sum((r) => r.aqi) / readings.length),
    avgPm25: Math.round(sum((r) => r.pm25) / readings.length),
    highCount: readings.filter((r) => isHighPollution(r.aqi)).length,
    worst: sorted[0],
    best: sorted[sorted.length - 1],
    regionAverages: regions
      .map((region) => {
        const rs = readings.filter((r) => r.region === region);
        return { region, zoneCount: rs.length, avgAqi: rs.length ? Math.round(sum((r) => r.aqi, rs) / rs.length) : 0 };
      })
      .filter((r) => r.zoneCount > 0),
  };
}

export interface TrendPoint {
  index: number;
  label: string;
  period: TimeStep["period"];
  [series: string]: number | string;
}

/** AQI per zone across every time step for the active preset. */
export function computeTrend(dataset: ZoneDataset, presetId: ScenarioPresetId): TrendPoint[] {
  return TIME_STEPS.map((step) => {
    const readings = computeReadings(dataset, step.index, presetId);
    const point: TrendPoint = { index: step.index, label: step.label, period: step.period };
    for (const r of readings) point[r.id] = r.aqi;
    const s = summarize(readings);
    point.city = s.avgAqi;
    for (const ra of s.regionAverages) point[`region:${ra.region}`] = ra.avgAqi;
    return point;
  });
}
