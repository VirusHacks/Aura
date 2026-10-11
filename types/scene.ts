import type { RegionId } from "./air-quality";

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];

export interface Rect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

export interface Circle {
  x: number;
  z: number;
  r: number;
}

export type RoadKind = "ring" | "arterial" | "highway" | "street" | "market";

export interface RoadDef {
  id: string;
  name: string;
  kind: RoadKind;
  width: number;
  /** Centreline polyline on the ground plane. */
  points: Vec2[];
  closed?: boolean;
  /** Relative vehicle density 0–1 used by the traffic system. */
  density: number;
  /** Signalised intersections are only created between roads with this flag. */
  signalised: boolean;
  /** Vehicle mix override (e.g. autos only in the old city market). */
  mix?: "market" | "freight" | "default";
}

export type FootprintKind =
  | "park"
  | "landmark"
  | "plaza"
  | "site"
  | "lot"
  | "rail"
  | "landfill";

export interface Footprint {
  id: string;
  kind: FootprintKind;
  rect?: Rect;
  circle?: Circle;
}

export interface CameraView {
  target: Vec3;
  distance: number;
  /** Polar angle from vertical, radians. Omit to keep the current one. */
  polar?: number;
  /** Azimuth around Y, radians. Omit to keep the current one. */
  azimuth?: number;
}

export interface RegionDef {
  id: RegionId;
  name: string;
  short: string;
  description: string;
  view: CameraView;
}

export interface LandmarkDef {
  id: string;
  name: string;
  region: RegionId;
  position: Vec2;
  /** Rough height of the landmark for label / ring placement. */
  height: number;
  /** Selection ring radius. */
  radius: number;
  zoneId: string;
  description: string;
  kind:
    | "monument"
    | "heritage"
    | "commercial"
    | "transport"
    | "river"
    | "industrial"
    | "construction"
    | "park"
    | "civic"
    | "residential"
    | "road";
  view: CameraView;
  quickNav?: boolean;
}

export type LayerId =
  | "heatmap"
  | "labels"
  | "sources"
  | "plumes"
  | "wind"
  | "traffic"
  | "boundaries";

export type LightingMode = "auto" | "day" | "sunset" | "night";

export type Selection =
  | { kind: "zone"; id: string }
  | { kind: "landmark"; id: string }
  | { kind: "source"; id: string }
  | { kind: "building"; id: number; zoneId: string };
