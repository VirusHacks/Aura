import type { AqiCategory, DominantPollutant } from "../types/air-quality";

export interface AqiBand {
  category: AqiCategory;
  min: number;
  max: number;
  color: string;
  /** Text colour that stays legible on top of `color`. */
  ink: string;
  short: string;
  advice: string;
}

/** Indian National AQI bands (CPCB). Single source of truth for the UI. */
export const AQI_BANDS: readonly AqiBand[] = [
  { category: "Good", min: 0, max: 50, color: "#2f9e44", ink: "#ffffff", short: "GOOD", advice: "Minimal impact." },
  { category: "Satisfactory", min: 51, max: 100, color: "#94c947", ink: "#1f2a10", short: "SATIS", advice: "Minor discomfort for sensitive people." },
  { category: "Moderate", min: 101, max: 200, color: "#f5c518", ink: "#3a2c00", short: "MOD", advice: "Breathing discomfort for people with lung or heart disease." },
  { category: "Poor", min: 201, max: 300, color: "#f08c00", ink: "#ffffff", short: "POOR", advice: "Breathing discomfort for most people on prolonged exposure." },
  { category: "Very Poor", min: 301, max: 400, color: "#e03131", ink: "#ffffff", short: "V.POOR", advice: "Respiratory illness on prolonged exposure." },
  { category: "Severe", min: 401, max: 500, color: "#7d1d2f", ink: "#ffffff", short: "SEVERE", advice: "Affects healthy people; serious impact on those with existing disease." },
] as const;

export const AQI_MAX = 500;

export function clampAqi(aqi: number): number {
  if (!Number.isFinite(aqi)) return 0;
  return Math.min(AQI_MAX, Math.max(0, Math.round(aqi)));
}

export function getAqiBand(aqi: number): AqiBand {
  const v = clampAqi(aqi);
  for (const band of AQI_BANDS) {
    if (v <= band.max) return band;
  }
  return AQI_BANDS[AQI_BANDS.length - 1];
}

export function getAqiCategory(aqi: number): AqiCategory {
  return getAqiBand(aqi).category;
}

export function getAqiColor(aqi: number): string {
  return getAqiBand(aqi).color;
}

export function isHighPollution(aqi: number): boolean {
  return clampAqi(aqi) > 200;
}

/** Concentration breakpoints (µg/m³, 24-h) paired with AQI sub-index ranges. */
type Breakpoint = readonly [cLo: number, cHi: number, iLo: number, iHi: number];

const PM25_BREAKPOINTS: readonly Breakpoint[] = [
  [0, 30, 0, 50],
  [31, 60, 51, 100],
  [61, 90, 101, 200],
  [91, 120, 201, 300],
  [121, 250, 301, 400],
  [251, 380, 401, 500],
];

const PM10_BREAKPOINTS: readonly Breakpoint[] = [
  [0, 50, 0, 50],
  [51, 100, 51, 100],
  [101, 250, 101, 200],
  [251, 350, 201, 300],
  [351, 430, 301, 400],
  [431, 510, 401, 500],
];

function breakpointsFor(p: DominantPollutant): readonly Breakpoint[] {
  return p === "PM2.5" ? PM25_BREAKPOINTS : PM10_BREAKPOINTS;
}

/** Sub-index for a concentration (linear interpolation within a band). */
export function subIndex(pollutant: DominantPollutant, concentration: number): number {
  const bps = breakpointsFor(pollutant);
  const c = Math.max(0, Math.round(concentration));
  for (const [cLo, cHi, iLo, iHi] of bps) {
    if (c <= cHi) {
      return Math.round(iLo + ((iHi - iLo) * (c - cLo)) / (cHi - cLo));
    }
  }
  return AQI_MAX;
}

/** Inverse of `subIndex`: the (rounded) concentration that produces a sub-index. */
export function concentrationForIndex(pollutant: DominantPollutant, index: number): number {
  const bps = breakpointsFor(pollutant);
  const i = clampAqi(index);
  for (const [cLo, cHi, iLo, iHi] of bps) {
    if (i <= iHi) {
      const c = Math.round(cLo + ((cHi - cLo) * (i - iLo)) / (iHi - iLo));
      // Rounding can land one step low; nudge until the forward mapping agrees.
      let adjusted = c;
      while (subIndex(pollutant, adjusted) < i && adjusted < cHi) adjusted += 1;
      return adjusted;
    }
  }
  return bps[bps.length - 1][1];
}

/** Overall AQI is the maximum of the pollutant sub-indices. */
export function aqiFromConcentrations(pm25: number, pm10: number): number {
  return Math.max(subIndex("PM2.5", pm25), subIndex("PM10", pm10));
}

/**
 * Continuous colour for the heatmap: interpolates between band colours so
 * neighbouring zones blend instead of stepping. Discrete UI elements must
 * use `getAqiColor` instead.
 */
export const AQI_GRADIENT_STOPS: readonly (readonly [number, string])[] = [
  [0, "#2f9e44"],
  [75, "#94c947"],
  [150, "#f5c518"],
  [250, "#f08c00"],
  [350, "#e03131"],
  [450, "#7d1d2f"],
];
