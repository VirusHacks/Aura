/**
 * Paths used by moving objects: traffic lanes derived from the road network
 * (left-hand traffic, as in India), the elevated metro viaduct and the
 * mainline railway.
 */
import type { RoadDef, Vec2 } from "../types/scene";
import { ANCHORS, WORLD } from "./city-layout";

export class PathCurve {
  readonly xs: Float32Array;
  readonly zs: Float32Array;
  readonly cum: Float32Array;
  readonly length: number;
  readonly closed: boolean;

  constructor(points: Vec2[], closed = false) {
    const pts = closed ? [...points, points[0]] : points;
    this.closed = closed;
    this.xs = new Float32Array(pts.map((p) => p[0]));
    this.zs = new Float32Array(pts.map((p) => p[1]));
    this.cum = new Float32Array(pts.length);
    for (let i = 1; i < pts.length; i++) {
      this.cum[i] = this.cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    }
    this.length = this.cum[pts.length - 1];
  }

  /** Writes position and heading (radians, three.js Y rotation for a +X-forward model) into `out`. */
  sample(s: number, out: { x: number; z: number; angle: number }) {
    const L = this.length;
    let t = this.closed ? ((s % L) + L) % L : Math.min(Math.max(s, 0), L);
    const cum = this.cum;
    let lo = 0;
    let hi = cum.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= t) lo = mid;
      else hi = mid;
    }
    const segLen = cum[hi] - cum[lo] || 1;
    t = (t - cum[lo]) / segLen;
    const dx = this.xs[hi] - this.xs[lo];
    const dz = this.zs[hi] - this.zs[lo];
    out.x = this.xs[lo] + dx * t;
    out.z = this.zs[lo] + dz * t;
    out.angle = Math.atan2(-dz, dx);
    return out;
  }

  /** Arc length of the closest point on the path to (x, z), and that distance. */
  project(x: number, z: number): { s: number; d: number; dx: number; dz: number } {
    let best = { s: 0, d: Infinity, dx: 1, dz: 0 };
    for (let i = 0; i < this.xs.length - 1; i++) {
      const ax = this.xs[i];
      const az = this.zs[i];
      const dx = this.xs[i + 1] - ax;
      const dz = this.zs[i + 1] - az;
      const l2 = dx * dx + dz * dz;
      if (l2 === 0) continue;
      let t = ((x - ax) * dx + (z - az) * dz) / l2;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(ax + dx * t - x, az + dz * t - z);
      if (d < best.d) {
        const len = Math.sqrt(l2);
        best = { s: this.cum[i] + t * len, d, dx: dx / len, dz: dz / len };
      }
    }
    return best;
  }
}

/** Offset a polyline to the left of travel by `offset` (mitred joins). */
export function offsetPolyline(points: Vec2[], offset: number, closed = false): Vec2[] {
  const n = points.length;
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const prev = points[closed ? (i - 1 + n) % n : Math.max(0, i - 1)];
    const next = points[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
    const cur = points[i];
    const d1 = norm(cur[0] - prev[0], cur[1] - prev[1]);
    const d2 = norm(next[0] - cur[0], next[1] - cur[1]);
    const a = i === 0 && !closed ? d2 : d1;
    const b = i === n - 1 && !closed ? d1 : d2;
    // Left normal for heading (dx, dz) with −Z north is (dz, −dx).
    let nx = a[1] + b[1];
    let nz = -a[0] - b[0];
    const len = Math.hypot(nx, nz) || 1;
    nx /= len;
    nz /= len;
    const dot = nx * a[1] + nz * -a[0];
    const miter = offset / Math.max(0.35, dot);
    out.push([cur[0] + nx * miter, cur[1] + nz * miter]);
  }
  return out;
}

function norm(x: number, z: number): [number, number] {
  const l = Math.hypot(x, z) || 1;
  return [x / l, z / l];
}

export type VehicleType = "car" | "auto" | "bus" | "truck" | "van";

export interface LaneStop {
  s: number;
  signal: number;
  /** true when the lane runs east–west through this junction. */
  ew: boolean;
}

export interface Lane {
  id: string;
  path: PathCurve;
  roadId: string;
  wraps: boolean;
  speed: number;
  vehicleCount: number;
  mix: RoadDef["mix"];
  stops: LaneStop[];
}

function laneOffsets(road: RoadDef): number[] {
  switch (road.kind) {
    case "ring":
      return [0.6, 1.6];
    case "highway":
      return [0.75, 1.95];
    case "market":
      return [0.55];
    case "street":
      return [0.45];
    default:
      return [0.85];
  }
}

const SPACING: Record<RoadDef["kind"], number> = {
  ring: 13,
  arterial: 17,
  highway: 9,
  market: 6,
  street: 26,
};

const SPEED: Record<RoadDef["kind"], number> = {
  ring: 7.5,
  arterial: 6.5,
  highway: 9.5,
  market: 1.8,
  street: 3.2,
};

export function buildLanes(
  roads: RoadDef[],
  signals: { x: number; z: number }[],
  densityScale = 1,
): Lane[] {
  const lanes: Lane[] = [];
  for (const road of roads) {
    if (road.kind === "street") continue;
    for (const dir of [1, -1]) {
      const base = dir === 1 ? road.points : [...road.points].reverse();
      for (const [k, off] of laneOffsets(road).entries()) {
        const pts = offsetPolyline(base, off, road.closed);
        const path = new PathCurve(pts, road.closed);
        const count = Math.max(1, Math.round((path.length / SPACING[road.kind]) * road.density * densityScale));
        const stops: LaneStop[] = [];
        if (road.signalised) {
          signals.forEach((sig, i) => {
            const p = path.project(sig.x, sig.z);
            if (p.d > road.width + 1) return;
            const back = 2.6;
            stops.push({ s: p.s - back, signal: i, ew: Math.abs(p.dx) > Math.abs(p.dz) });
          });
          stops.sort((a, b) => a.s - b.s);
        }
        lanes.push({
          id: `${road.id}:${dir}:${k}`,
          path,
          roadId: road.id,
          wraps: !road.closed,
          speed: SPEED[road.kind] * (k === 0 ? 0.92 : 1.06),
          vehicleCount: count,
          mix: road.mix ?? "default",
          stops,
        });
      }
    }
  }
  return lanes;
}

/** Signal phase for a junction. Returns whether E–W and N–S movements may proceed. */
export const SIGNAL_CYCLE = 18;
export function signalPhase(signalIndex: number, x: number, z: number, t: number) {
  const offset = ((x + z) * 0.07 + signalIndex * 0.37) % SIGNAL_CYCLE;
  const p = (((t + offset) % SIGNAL_CYCLE) + SIGNAL_CYCLE) % SIGNAL_CYCLE;
  // 0–7.5 EW green, 7.5–9 EW amber, 9–16.5 NS green, 16.5–18 NS amber.
  const ew = p < 7.5 ? "green" : p < 9 ? "amber" : "red";
  const ns = p >= 9 && p < 16.5 ? "green" : p >= 16.5 ? "amber" : "red";
  return { ew, ns } as const;
}

// ─── Metro ─────────────────────────────────────────────────────────────────
function cornerPath(points: Vec2[], radius: number, seg = 10): Vec2[] {
  const out: Vec2[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const p0 = points[i - 1];
    const p1 = points[i];
    const p2 = points[i + 1];
    const a = norm(p0[0] - p1[0], p0[1] - p1[1]);
    const b = norm(p2[0] - p1[0], p2[1] - p1[1]);
    const s: Vec2 = [p1[0] + a[0] * radius, p1[1] + a[1] * radius];
    const e: Vec2 = [p1[0] + b[0] * radius, p1[1] + b[1] * radius];
    for (let k = 0; k <= seg; k++) {
      const t = k / seg;
      // Quadratic Bézier through the corner.
      const x = (1 - t) * (1 - t) * s[0] + 2 * (1 - t) * t * p1[0] + t * t * e[0];
      const z = (1 - t) * (1 - t) * s[1] + 2 * (1 - t) * t * p1[1] + t * t * e[1];
      out.push([x, z]);
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

export const METRO_CENTERLINE: Vec2[] = cornerPath(
  [
    [WORLD.maxX - 6, -36],
    [-22, -36],
    [-22, 84],
  ],
  9,
);

export const METRO_TRACK_OFFSET = 0.72;
export const METRO_DECK_Y = ANCHORS.metroDeckY;

export const METRO_STATIONS: { id: string; name: string; at: Vec2 }[] = [
  { id: "laxmi-nagar", name: "Laxmi Nagar", at: [100, -36] },
  { id: "mandi-house", name: "Mandi House", at: [30, -36] },
  { id: "new-delhi", name: "New Delhi", at: [4, -36] },
  { id: "central-sec", name: "Central Secretariat", at: [-22, -2] },
  { id: "ina", name: "INA", at: [-22, 47] },
  { id: "qutub", name: "Qutub Minar", at: [-22, 78] },
];

export function metroCurve(offset: number) {
  return new PathCurve(offsetPolyline(METRO_CENTERLINE, offset));
}

/** Mainline railway (straight, wraps at the edges of the world). */
export const RAIL_TRACKS = [ANCHORS.railwayZ - 0.75, ANCHORS.railwayZ + 0.75];
