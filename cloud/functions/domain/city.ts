/**
 * City data and scenario readings. Readings come from the web dashboard's own
 * engine (lib/simulation-engine.ts), so the backend, the watch and the 3D city
 * show the same AQI for the same scenario.
 */
import { ZONE_GEO, ZONE_LINKS } from "../../../data/delhi-geo";
import { DEMO_DATASET } from "../../../data/demo-zones";
import { getAqiCategory } from "../../../lib/aqi";
import { type CityProjection, type GeoZone, makeProjection } from "../../../lib/geo";
import { PRESET_BY_ID, TIME_STEPS, computeZoneReading, scenarioConditions } from "../../../lib/simulation-engine";
import { parseZoneDataset } from "../../../lib/zone-schema";
import type { AirQualityZone, GeoPoint, Scenario, ScenarioWithLabel, ZoneReadingV1 } from "../../../types/api";
import type { ScenarioPresetId, ZoneBaseline, ZoneDataset } from "../../../types/air-quality";

export type CityZone = ZoneBaseline & { geo?: GeoPoint };

export interface City {
  dataset: ZoneDataset & { zones: CityZone[] };
  links: readonly (readonly [string, string])[];
  projection: CityProjection | null;
  byId: Map<string, CityZone>;
}

export function buildCity(dataset: ZoneDataset): City {
  const zones: CityZone[] = dataset.zones.map((z) => ({ ...z, geo: ZONE_GEO[z.id] }));
  const geoZones: GeoZone[] = zones;
  return {
    dataset: { ...dataset, zones },
    links: ZONE_LINKS,
    projection: makeProjection(geoZones),
    byId: new Map(zones.map((z) => [z.id, z])),
  };
}

export const DEMO_CITY = buildCity(DEMO_DATASET);

/**
 * Builds the dataset from `ZoneBaselines` table items (written by
 * infra/scripts/seed-zones.ts): a `__meta__` row plus one row per zone.
 */
export function datasetFromItems(items: Record<string, unknown>[], provenance: "demo" | "verified"): ZoneDataset | null {
  const meta = items.find((i) => i.id === "__meta__");
  const zones = items.filter((i) => i.id !== "__meta__");
  if (zones.length === 0) return null;
  try {
    return parseZoneDataset({
      provenance,
      sourceLabel: typeof meta?.sourceLabel === "string" ? meta.sourceLabel : "Demo dataset served from AWS",
      baselineTime: typeof meta?.baselineTime === "string" ? meta.baselineTime : new Date(0).toISOString(),
      zones: zones.sort((a, b) => String(a.id).localeCompare(String(b.id))),
    });
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- Scenario

export const DEFAULT_PRESET: ScenarioPresetId = "traffic-haze";

export function normalizeScenario(s: Partial<Scenario> | null | undefined): Scenario {
  const preset = s?.preset && PRESET_BY_ID[s.preset] ? s.preset : DEFAULT_PRESET;
  const timeIndex = Number.isInteger(s?.timeIndex) ? Math.min(7, Math.max(0, s!.timeIndex as number)) : 3;
  return { preset, timeIndex };
}

export function scenarioLabel(s: Scenario): string {
  return `${PRESET_BY_ID[s.preset].label} · ${TIME_STEPS[s.timeIndex].label}`;
}

export function withLabel(s: Scenario): ScenarioWithLabel {
  return { ...s, label: scenarioLabel(s) };
}

/** The 3-hourly step nearest to the wall-clock time in Delhi (IST). */
export function scenarioForClock(preset: ScenarioPresetId, date: Date): Scenario {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: "Asia/Kolkata" }).format(date));
  const dist = (h: number) => Math.min(Math.abs(h - hour) % 24, 24 - (Math.abs(h - hour) % 24));
  let best = TIME_STEPS[0];
  for (const step of TIME_STEPS) if (dist(step.hour) < dist(best.hour)) best = step;
  return { preset, timeIndex: best.index };
}

// ---------------------------------------------------------------- Readings

/** A zone's scenario reading in the shape the watch decodes. */
export function zoneReading(zone: ZoneBaseline, scenario: Scenario, provenance: ZoneDataset["provenance"]): ZoneReadingV1 {
  const r = computeZoneReading(zone, scenario.timeIndex, scenario.preset, provenance);
  return {
    zoneId: r.id,
    zoneName: r.name,
    region: r.region,
    aqi: r.aqi,
    category: getAqiCategory(r.aqi),
    pm25: r.pm25,
    pm10: r.pm10,
    dominant: r.dominant,
    temperature: r.temperature,
    windSpeed: r.windSpeed,
    scenarioTime: r.timestamp,
    provenance: r.provenance,
    simulated: true,
  };
}

export function readingsByZone(city: City, scenario: Scenario): Map<string, ZoneReadingV1> {
  return new Map(city.dataset.zones.map((z) => [z.id, zoneReading(z, scenario, city.dataset.provenance)]));
}

/**
 * Spec `AirQualityZone`. Every reading derived through the scenario model is
 * DEMO data — even on a verified baseline — and is labelled as such.
 */
export function airQualityZone(zone: CityZone, scenario: Scenario, provenance: ZoneDataset["provenance"], observedAt: string): AirQualityZone {
  const r = computeZoneReading(zone, scenario.timeIndex, scenario.preset, provenance);
  return {
    zoneId: zone.id,
    zoneName: zone.name,
    region: zone.region,
    aqi: r.aqi,
    aqiCategory: getAqiCategory(r.aqi),
    pm25: r.pm25,
    pm10: r.pm10,
    latitude: zone.geo?.lat ?? null,
    longitude: zone.geo?.lon ?? null,
    world: { x: zone.position[0], z: zone.position[1] },
    radius: zone.radius,
    windSpeed: r.windSpeed,
    windDirection: scenarioConditions(scenario.timeIndex, scenario.preset).windFrom,
    observedAt,
    source: "DEMO",
    provenance,
    isDemo: true,
  };
}
