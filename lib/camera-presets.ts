import type { CameraView } from "../types/scene";

/** Default high-altitude overview that reveals the whole city. */
export const DEFAULT_VIEW: CameraView = {
  target: [6, 0, 2],
  distance: 360,
  polar: 0.86,
  azimuth: 0.6,
};

export const CAMERA_LIMITS = {
  minDistance: 14,
  maxDistance: 420,
  minPolar: 0.12,
  maxPolar: 1.32,
  boundsMin: [-150, 0, -120] as const,
  boundsMax: [150, 12, 120] as const,
};

/** Label level of detail by camera distance. */
export type ZoomLevel = "far" | "mid" | "near";
export function zoomLevelFor(distance: number): ZoomLevel {
  if (distance > 200) return "far";
  if (distance > 95) return "mid";
  return "near";
}

export function viewForPoint(x: number, z: number, distance: number, y = 0): CameraView {
  return { target: [x, y, z], distance, polar: 0.95 };
}
