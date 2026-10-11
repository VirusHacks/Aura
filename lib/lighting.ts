import type { LightingMode } from "../types/scene";
import { TIME_STEPS } from "./simulation-engine";

export type ResolvedLighting = "day" | "sunset" | "night";

/** "auto" follows the simulated clock; explicit modes override it. */
export function resolveLighting(mode: LightingMode, timeIndex: number): ResolvedLighting {
  if (mode !== "auto") return mode;
  const hour = TIME_STEPS[timeIndex]?.hour ?? 15;
  if (hour === 18) return "sunset";
  if (hour >= 21 || hour < 6) return "night";
  return "day";
}

export interface LightingPreset {
  sun: [number, number, number];
  sunColor: string;
  sunIntensity: number;
  skyColor: string;
  groundColor: string;
  hemiIntensity: number;
  ambient: number;
  fog: string;
  night: number;
}

export const LIGHTING_PRESETS: Record<ResolvedLighting, LightingPreset> = {
  day: {
    sun: [-70, 150, 55],
    sunColor: "#fff3e0",
    sunIntensity: 2.7,
    skyColor: "#e4ecf4",
    groundColor: "#d9ccb4",
    hemiIntensity: 1.25,
    ambient: 0.25,
    fog: "#e7e1d5",
    night: 0,
  },
  sunset: {
    sun: [-150, 48, 40],
    sunColor: "#ffb07a",
    sunIntensity: 2.3,
    skyColor: "#f0c9ad",
    groundColor: "#a98d7a",
    hemiIntensity: 0.85,
    ambient: 0.2,
    fog: "#e6c3a8",
    night: 0.35,
  },
  night: {
    sun: [-60, 130, 30],
    sunColor: "#9db3ff",
    sunIntensity: 0.32,
    skyColor: "#2e3d61",
    groundColor: "#151924",
    hemiIntensity: 0.55,
    ambient: 0.12,
    fog: "#131b2c",
    night: 1,
  },
};
