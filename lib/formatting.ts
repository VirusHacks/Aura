import type { RegionId, SourceCategory } from "../types/air-quality";

export const REGION_LABEL: Record<RegionId, string> = {
  central: "Central Delhi",
  old: "Old Delhi",
  east: "East Delhi",
  south: "South Delhi",
  industrial: "Industrial & Outer",
};

export const SOURCE_LABEL: Record<SourceCategory, string> = {
  traffic: "Road traffic",
  construction: "Construction",
  industrial: "Industrial",
  commercial: "Dense commercial",
  "waste-burning": "Waste burning",
};

export const SOURCE_COLOR: Record<SourceCategory, string> = {
  traffic: "#4f6bed",
  construction: "#c98a2b",
  industrial: "#6b5ca5",
  commercial: "#0e8f8a",
  "waste-burning": "#a3523a",
};

const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];

export function compass(bearing: number): string {
  return COMPASS[Math.round((((bearing % 360) + 360) % 360) / 22.5) % 16];
}

export function formatScenarioTime(iso: string): string {
  const m = /T(\d{2}):(\d{2})/.exec(iso);
  return m ? `${m[1]}:${m[2]}` : iso;
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat("en-IN").format(n);
}
