export type RegionId = "central" | "old" | "east" | "south" | "industrial";

export type AqiCategory =
  | "Good"
  | "Satisfactory"
  | "Moderate"
  | "Poor"
  | "Very Poor"
  | "Severe";

export type DataProvenance = "demo" | "verified";

export type SourceCategory =
  | "traffic"
  | "construction"
  | "industrial"
  | "commercial"
  | "waste-burning";

export type DominantPollutant = "PM2.5" | "PM10";

/** Compass bearing the wind blows FROM, in degrees (0 = north, 90 = east). */
export type WindBearing = number;

/**
 * Baseline description of a zone. These are the values a data provider
 * supplies; the simulation engine derives scenario readings from them.
 */
export interface ZoneBaseline {
  id: string;
  name: string;
  region: RegionId;
  /** World-space centre on the ground plane (x, z). */
  position: [number, number];
  /** Approximate influence radius in world units. */
  radius: number;
  /** Baseline AQI for the reference scenario (afternoon, urban haze). */
  baseAqi: number;
  dominant: DominantPollutant;
  /** Share of local load attributed to road traffic, 0–1. */
  trafficShare: number;
  /** Baseline air temperature in °C. */
  baseTemperature: number;
  sources: SourceCategory[];
  description: string;
}

export interface ZoneDataset {
  provenance: DataProvenance;
  /** Human readable origin, e.g. "Bundled deterministic demo dataset". */
  sourceLabel: string;
  /** ISO timestamp of the baseline the dataset represents. */
  baselineTime: string;
  zones: ZoneBaseline[];
}

/** A fully resolved reading for one zone at one simulated moment. */
export interface ZoneReading {
  id: string;
  name: string;
  region: RegionId;
  position: [number, number];
  radius: number;
  aqi: number;
  category: AqiCategory;
  pm25: number;
  pm10: number;
  dominant: DominantPollutant;
  temperature: number;
  windSpeed: number;
  windFrom: WindBearing;
  sources: SourceCategory[];
  /** Simulated scenario time in ISO form. */
  timestamp: string;
  provenance: DataProvenance;
  simulated: boolean;
}

export interface PollutionSource {
  id: string;
  name: string;
  category: SourceCategory;
  zoneId: string;
  position: [number, number];
  /** Illustrative relative activity index 0–1 (demo, not an emission inventory). */
  baseActivity: number;
  note: string;
}

export interface SourceReading extends PollutionSource {
  activity: number;
}

export type ScenarioPresetId =
  | "clear-morning"
  | "traffic-haze"
  | "winter-stagnation"
  | "breezy-dispersal";

export interface ScenarioPreset {
  id: ScenarioPresetId;
  label: string;
  description: string;
  /** Multiplier applied to all zone loads. */
  load: number;
  /** Extra multiplier for the traffic share of each zone. */
  trafficBoost: number;
  windSpeed: number;
  windFrom: WindBearing;
  temperatureOffset: number;
  /** Visual haze density 0–1, used by the renderer only. */
  haze: number;
}

export interface TimeStep {
  index: number;
  hour: number;
  label: string;
  period: "Morning" | "Afternoon" | "Evening" | "Night";
  /** Relative traffic activity for this hour. */
  traffic: number;
  /** Mixing-layer factor: >1 traps pollution near ground. */
  mixing: number;
  temperatureOffset: number;
  windFactor: number;
}
