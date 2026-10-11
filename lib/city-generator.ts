/**
 * Deterministic procedural generation of the stylised city: local streets,
 * building lots, trees, street furniture and parked vehicles.
 *
 * Everything is placed against a rasterised occupancy grid so roads, the
 * river, landmarks and buildings never overlap.
 */
import type { RegionId } from "../types/air-quality";
import type { RoadDef, Vec2 } from "../types/scene";
import {
  ANCHORS,
  ARTERIALS,
  FOOTPRINTS,
  REGION_BOUNDS,
  RIVER_BANK,
  RIVER_HALF_WIDTH,
  WORLD,
  riverDistance,
  regionAt,
} from "./city-layout";
import { createRng, type Rng } from "./rng";

// ─── Occupancy grid ────────────────────────────────────────────────────────
export const CELL = 0.5;
const GW = Math.ceil((WORLD.maxX - WORLD.minX) / CELL);
const GH = Math.ceil((WORLD.maxZ - WORLD.minZ) / CELL);

export const Occ = {
  Free: 0,
  Road: 1,
  Water: 2,
  Rail: 3,
  Park: 4,
  Reserved: 5,
  Building: 6,
  Sidewalk: 7,
  Bank: 8,
  Yard: 9,
} as const;

class Grid {
  data = new Uint8Array(GW * GH);
  idx(x: number, z: number) {
    const i = Math.floor((x - WORLD.minX) / CELL);
    const j = Math.floor((z - WORLD.minZ) / CELL);
    if (i < 0 || j < 0 || i >= GW || j >= GH) return -1;
    return j * GW + i;
  }
  get(x: number, z: number): number {
    const k = this.idx(x, z);
    return k < 0 ? Occ.Reserved : this.data[k];
  }
  set(x: number, z: number, v: number) {
    const k = this.idx(x, z);
    if (k >= 0) this.data[k] = v;
  }
  /** Iterate cell centres inside an axis-aligned box. */
  forBox(x0: number, x1: number, z0: number, z1: number, fn: (x: number, z: number, k: number) => void) {
    const i0 = Math.max(0, Math.floor((x0 - WORLD.minX) / CELL));
    const i1 = Math.min(GW - 1, Math.floor((x1 - WORLD.minX) / CELL));
    const j0 = Math.max(0, Math.floor((z0 - WORLD.minZ) / CELL));
    const j1 = Math.min(GH - 1, Math.floor((z1 - WORLD.minZ) / CELL));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        fn(WORLD.minX + (i + 0.5) * CELL, WORLD.minZ + (j + 0.5) * CELL, j * GW + i);
      }
    }
  }
}

function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz;
  let t = l2 === 0 ? 0 : ((px - ax) * dx + (pz - az) * dz) / l2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = ax + t * dx - px;
  const qz = az + t * dz - pz;
  return Math.sqrt(qx * qx + qz * qz);
}

export function roadSegments(road: RoadDef): [Vec2, Vec2][] {
  const segs: [Vec2, Vec2][] = [];
  const n = road.closed ? road.points.length : road.points.length - 1;
  for (let i = 0; i < n; i++) segs.push([road.points[i], road.points[(i + 1) % road.points.length]]);
  return segs;
}

function rasterRoad(grid: Grid, road: RoadDef, sidewalk: number) {
  const half = road.width / 2;
  for (const [a, b] of roadSegments(road)) {
    const pad = half + sidewalk + CELL;
    grid.forBox(
      Math.min(a[0], b[0]) - pad,
      Math.max(a[0], b[0]) + pad,
      Math.min(a[1], b[1]) - pad,
      Math.max(a[1], b[1]) + pad,
      (x, z, k) => {
        const d = segDist(x, z, a[0], a[1], b[0], b[1]);
        const cur = grid.data[k];
        if (d <= half) {
          if (cur !== Occ.Water) grid.data[k] = Occ.Road;
        } else if (d <= half + sidewalk) {
          if (cur === Occ.Free || cur === Occ.Park) grid.data[k] = Occ.Sidewalk;
        }
      },
    );
  }
}

// ─── Output types ──────────────────────────────────────────────────────────
export const BUILDING_KINDS = [
  "Haveli & mixed-use block",
  "Bungalow",
  "Office building",
  "Glass office tower",
  "Apartment block",
  "Group-housing tower",
  "Warehouse shed",
  "Shop-house",
] as const;

export interface BuildingSet {
  count: number;
  x: Float32Array;
  z: Float32Array;
  w: Float32Array;
  d: Float32Array;
  h: Float32Array;
  rot: Float32Array;
  color: Float32Array;
  /** 0 = plain shed, 1 = punched windows, 2 = glass curtain wall. */
  style: Float32Array;
  kind: Uint8Array;
  region: RegionId[];
  /** Pitched-roof flag (bungalows). */
  pitched: Uint8Array;
}

export interface PropSet {
  count: number;
  /** x, y, z, rotY, sx, sy, sz per instance. */
  data: Float32Array;
  color?: Float32Array;
}

export interface CityModel {
  streets: RoadDef[];
  roads: RoadDef[];
  buildings: BuildingSet;
  tanks: PropSet;
  stairRooms: PropSet;
  roofCaps: PropSet;
  pitchedRoofs: PropSet;
  treesRound: PropSet;
  treesTall: PropSet;
  lamps: PropSet;
  parkedCars: PropSet;
  parkedBuses: PropSet;
  parkedTrucks: PropSet;
  stalls: PropSet;
  signals: { x: number; z: number }[];
  crosswalks: PropSet;
  grid: { data: Uint8Array; width: number; height: number; cell: number };
}

class PropBuilder {
  data: number[] = [];
  color: number[] = [];
  push(x: number, y: number, z: number, rot: number, sx: number, sy: number, sz: number, c?: [number, number, number]) {
    this.data.push(x, y, z, rot, sx, sy, sz);
    if (c) this.color.push(c[0], c[1], c[2]);
  }
  build(): PropSet {
    return {
      count: this.data.length / 7,
      data: new Float32Array(this.data),
      color: this.color.length ? new Float32Array(this.color) : undefined,
    };
  }
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function vary(c: [number, number, number], rng: Rng, amount = 0.05): [number, number, number] {
  const f = 1 + (rng.next() - 0.5) * 2 * amount;
  return [Math.min(1, c[0] * f), Math.min(1, c[1] * f), Math.min(1, c[2] * f)];
}

const PALETTES: Record<string, string[]> = {
  old: ["#e3c7a1", "#dcb48a", "#e8cfb0", "#e6b9a3", "#efe2c8", "#c9d6c9", "#e2c48e", "#d9a98a", "#f0dcc0", "#cdbfae"],
  central: ["#f2eee5", "#ece6d8", "#f6f4ee", "#dfe2e3", "#e8e1d0", "#d9dcdd"],
  lutyens: ["#f4efe4", "#efe5d2", "#f7f3ea", "#eadfcb"],
  glass: ["#a9bccb", "#9db2c2", "#b6c6d2", "#8fa6b8", "#c2cfd8"],
  south: ["#f3eee4", "#ede3d2", "#f1e6dc", "#e9e2d6", "#f5efe6", "#e6dccd", "#efe0d6"],
  east: ["#ece4d3", "#e4dccd", "#efe9dc", "#e3d9c4", "#dcd8cf", "#f0e6d0"],
  industrial: ["#cfd2d2", "#c2c8cc", "#d8d6cf", "#bfc5c3", "#d3cdc0"],
  industrialRoof: ["#7f9bb0", "#9aa9b3", "#6f8796", "#a3aaa8", "#8aa0a8", "#b0a99a"],
};

const CAR_COLORS = ["#f4f4f2", "#d7dadd", "#9aa1a8", "#2f3439", "#b23b32", "#2d5a8c", "#c9c2b4", "#5d6b78", "#e8e6df", "#7a2e2b"];

// ─── Local streets ─────────────────────────────────────────────────────────
interface StreetSpec {
  region: RegionId;
  spacingX: number;
  spacingZ: number;
  width: number;
  jitter: number;
  breakChance: number;
}

const STREET_SPECS: StreetSpec[] = [
  { region: "old", spacingX: 7.5, spacingZ: 7, width: 1.6, jitter: 1.1, breakChance: 0.12 },
  { region: "central", spacingX: 13, spacingZ: 12, width: 2, jitter: 0, breakChance: 0 },
  { region: "south", spacingX: 11, spacingZ: 10, width: 2, jitter: 0.4, breakChance: 0.04 },
  { region: "east", spacingX: 10, spacingZ: 10, width: 2, jitter: 0.3, breakChance: 0.05 },
  { region: "industrial", spacingX: 16, spacingZ: 14, width: 2.4, jitter: 0, breakChance: 0.05 },
];

function blocksStreet(v: number) {
  return v === Occ.Water || v === Occ.Bank || v === Occ.Park || v === Occ.Reserved || v === Occ.Rail;
}

function generateStreets(grid: Grid, rng: Rng): RoadDef[] {
  const streets: RoadDef[] = [];
  const arterialXs = ARTERIALS.filter((r) => r.points.length === 2 && r.points[0][0] === r.points[1][0]).map((r) => r.points[0][0]);
  const arterialZs = ARTERIALS.filter((r) => r.points.length === 2 && r.points[0][1] === r.points[1][1]).map((r) => r.points[0][1]);
  arterialXs.push(2, -46, 56);
  arterialZs.push(8, -90, 68, ANCHORS.railwayZ);

  for (const spec of STREET_SPECS) {
    const b = REGION_BOUNDS[spec.region];
    const emit = (vertical: boolean, c: number, from: number, to: number) => {
      const near = (vertical ? arterialXs : arterialZs).some((a) => Math.abs(a - c) < 4.5);
      if (near) return;
      let start: number | null = null;
      const step = CELL;
      const flush = (end: number) => {
        if (start !== null && end - start > 6) {
          const pts: Vec2[] = vertical ? [[c, start], [c, end]] : [[start, c], [end, c]];
          streets.push({
            id: `st-${streets.length}`,
            name: "Local street",
            kind: "street",
            width: spec.width,
            points: pts,
            density: spec.region === "industrial" ? 0.25 : 0.18,
            signalised: false,
          });
        }
        start = null;
      };
      for (let t = from; t <= to; t += step) {
        const x = vertical ? c : t;
        const z = vertical ? t : c;
        const v = grid.get(x, z);
        const ok = !blocksStreet(v) && regionAt(x, z) === spec.region;
        if (ok && start === null) start = t;
        if (!ok && start !== null) flush(t - step);
      }
      if (start !== null) flush(to);
    };
    for (let x = b.x0 + spec.spacingX / 2; x < b.x1; x += spec.spacingX) {
      const c = x + (rng.next() - 0.5) * spec.jitter;
      if (spec.breakChance > 0 && rng.chance(spec.breakChance)) {
        const cut = b.z0 + rng.next() * (b.z1 - b.z0);
        emit(true, c, b.z0 + 1, cut - 3);
        emit(true, c, cut + 3, b.z1 - 1);
      } else emit(true, c, b.z0 + 1, b.z1 - 1);
    }
    for (let z = b.z0 + spec.spacingZ / 2; z < b.z1; z += spec.spacingZ) {
      const c = z + (rng.next() - 0.5) * spec.jitter;
      if (spec.breakChance > 0 && rng.chance(spec.breakChance)) {
        const cut = b.x0 + rng.next() * (b.x1 - b.x0);
        emit(false, c, b.x0 + 1, cut - 3);
        emit(false, c, cut + 3, b.x1 - 1);
      } else emit(false, c, b.x0 + 1, b.x1 - 1);
    }
  }
  return streets;
}

// ─── Buildings ─────────────────────────────────────────────────────────────
interface LotSpec {
  pitch: number;
  size: [number, number];
  height: [number, number];
  palette: string;
  style: number;
  kind: number;
  rotJitter: number;
}

function lotSpecFor(region: RegionId, x: number, z: number, rng: Rng): LotSpec {
  switch (region) {
    case "old":
      return {
        pitch: 2.5,
        size: [1.2, 1.9],
        height: [0.9, 3.2],
        palette: "old",
        style: 1,
        kind: rng.chance(0.3) ? 7 : 0,
        rotJitter: 0.05,
      };
    case "central": {
      if (z > -5 && x < 34) {
        return { pitch: 5.2, size: [2.4, 3.2], height: [0.8, 1.3], palette: "lutyens", style: 1, kind: 1, rotJitter: 0 };
      }
      const nearCore = Math.hypot(x - 2, z + 14) < 32 || Math.abs(z + 36) < 9;
      if (nearCore && rng.chance(0.45)) {
        return { pitch: 4.4, size: [2.6, 3.8], height: [4, 11], palette: "glass", style: 2, kind: 3, rotJitter: 0 };
      }
      return { pitch: 4.2, size: [2.2, 3.2], height: [1.6, 4.6], palette: "central", style: 1, kind: 2, rotJitter: 0 };
    }
    case "south":
      return { pitch: 3.6, size: [1.9, 2.7], height: [1.5, 3.6], palette: "south", style: 1, kind: 4, rotJitter: 0.02 };
    case "east": {
      const towers = x > 100 && z > -28 && z < 4;
      if (towers && rng.chance(0.6)) {
        return { pitch: 4.6, size: [2.8, 3.4], height: [7, 15], palette: "east", style: 1, kind: 5, rotJitter: 0 };
      }
      return { pitch: 3.3, size: [1.9, 2.6], height: [1.8, 5.2], palette: "east", style: 1, kind: 4, rotJitter: 0.02 };
    }
    case "industrial":
      return { pitch: 6.6, size: [3.6, 5.8], height: [1, 2.4], palette: "industrial", style: 0, kind: 6, rotJitter: 0 };
  }
}

function rectFree(grid: Grid, x: number, z: number, w: number, d: number, rot: number, allowed: (v: number) => boolean) {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  for (let u = -w / 2; u <= w / 2 + 1e-6; u += CELL * 0.9) {
    for (let v = -d / 2; v <= d / 2 + 1e-6; v += CELL * 0.9) {
      const px = x + u * c - v * s;
      const pz = z + u * s + v * c;
      if (!allowed(grid.get(px, pz))) return false;
    }
  }
  return true;
}

function markRect(grid: Grid, x: number, z: number, w: number, d: number, rot: number, value: number) {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  for (let u = -w / 2; u <= w / 2 + 1e-6; u += CELL * 0.5) {
    for (let v = -d / 2; v <= d / 2 + 1e-6; v += CELL * 0.5) {
      const px = x + u * c - v * s;
      const pz = z + u * s + v * c;
      const cur = grid.get(px, pz);
      if (cur === Occ.Free || cur === Occ.Yard) grid.set(px, pz, value);
    }
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────
let cached: CityModel | null = null;

export function getCityModel(): CityModel {
  if (!cached) cached = generateCity(20251114);
  return cached;
}

function generateCity(seed: number): CityModel {
  const rng = createRng(seed);
  const grid = new Grid();

  // River + banks.
  grid.forBox(WORLD.minX, WORLD.maxX, WORLD.minZ, WORLD.maxZ, (x, z, k) => {
    const d = riverDistance(x, z);
    if (d < RIVER_HALF_WIDTH) grid.data[k] = Occ.Water;
    else if (d < RIVER_HALF_WIDTH + RIVER_BANK) grid.data[k] = Occ.Bank;
    else if (Math.abs(z - ANCHORS.railwayZ) < 1.6) grid.data[k] = Occ.Rail;
  });

  // Footprints.
  for (const f of FOOTPRINTS) {
    const v = f.kind === "park" ? Occ.Park : f.kind === "rail" ? Occ.Rail : Occ.Reserved;
    if (f.rect) {
      grid.forBox(f.rect.x0, f.rect.x1, f.rect.z0, f.rect.z1, (_x, _z, k) => {
        if (grid.data[k] !== Occ.Water) grid.data[k] = v;
      });
    } else if (f.circle) {
      const c = f.circle;
      grid.forBox(c.x - c.r, c.x + c.r, c.z - c.r, c.z + c.r, (x, z, k) => {
        if ((x - c.x) ** 2 + (z - c.z) ** 2 <= c.r * c.r) grid.data[k] = v;
      });
    }
  }

  // Arterials first, then local streets that respect them.
  for (const r of ARTERIALS) rasterRoad(grid, r, r.kind === "market" ? 1.4 : 1.1);
  const streets = generateStreets(grid, rng);
  for (const r of streets) rasterRoad(grid, r, 0.55);
  const roads = [...ARTERIALS, ...streets];

  // Buildings.
  const B = {
    x: [] as number[], z: [] as number[], w: [] as number[], d: [] as number[], h: [] as number[],
    rot: [] as number[], color: [] as number[], style: [] as number[], kind: [] as number[],
    region: [] as RegionId[], pitched: [] as number[],
  };
  const tanks = new PropBuilder();
  const stairRooms = new PropBuilder();
  const roofCaps = new PropBuilder();
  const pitchedRoofs = new PropBuilder();
  const free = (v: number) => v === Occ.Free;

  // Greedy raster packing: walk the grid and drop a plot at the first free
  // corner of every block, so buildings line the streets like real plots.
  const GAP: Record<RegionId, number> = { old: 0.12, central: 0.9, south: 0.75, east: 0.85, industrial: 1.5 };
  const YARD: Record<RegionId, number> = { old: 0.02, central: 0.08, south: 0.1, east: 0.07, industrial: 0.12 };
  for (let z0 = WORLD.minZ + 1; z0 < WORLD.maxZ - 1; z0 += CELL) {
    for (let x0 = WORLD.minX + 1; x0 < WORLD.maxX - 1; x0 += CELL) {
      if (grid.get(x0 + 0.01, z0 + 0.01) !== Occ.Free) continue;
      const region = regionAt(x0, z0);
      const spec = lotSpecFor(region, x0, z0, rng);
      const lutyens = spec.kind === 1;
      const gap = lutyens ? 2.4 : GAP[region];
      let w = rng.range(spec.size[0], spec.size[1]);
      let d = rng.range(spec.size[0], spec.size[1]);
      if (spec.kind === 6 && rng.chance(0.5)) d *= rng.range(0.6, 0.85);
      if (spec.kind === 6 && rng.chance(0.5)) w *= rng.range(0.6, 0.85);
      let ok = false;
      for (let attempt = 0; attempt < 4 && !ok; attempt++) {
        ok = rectFree(grid, x0 + w / 2, z0 + d / 2, w, d, 0, free);
        if (!ok) {
          w = Math.max(1.0, w * 0.74);
          d = Math.max(1.0, d * 0.74);
        }
      }
      if (!ok) {
        grid.set(x0 + 0.01, z0 + 0.01, Occ.Yard);
        continue;
      }
      const jx = x0 + w / 2;
      const jz = z0 + d / 2;
      if (rng.chance(YARD[region])) {
        // Leave an open courtyard / garden plot instead of a building.
        markRect(grid, jx, jz, w + gap, d + gap, 0, Occ.Yard);
        continue;
      }
      markRect(grid, jx, jz, w + gap, d + gap, 0, Occ.Building);
      const rot = (rng.next() - 0.5) * 2 * spec.rotJitter;
        let h = spec.height[0] + (spec.height[1] - spec.height[0]) * Math.pow(rng.next(), 1.6);
        if (spec.kind === 4 && rng.chance(0.06)) h *= 1.8;
        if (spec.kind === 0 && rng.chance(0.08)) h *= 1.35;
        h = Math.round(h / 0.62) * 0.62 + 0.12;
        const col = vary(hexToRgb(rng.pick(PALETTES[spec.palette])), rng, 0.04);

        B.x.push(jx); B.z.push(jz); B.w.push(w); B.d.push(d); B.h.push(h); B.rot.push(rot);
        B.color.push(...col); B.style.push(spec.style); B.kind.push(spec.kind); B.region.push(region);
        const pitched = spec.kind === 1 ? 1 : 0;
        B.pitched.push(pitched);

        // Roof details.
        const c = Math.cos(rot);
        const s = Math.sin(rot);
        const local = (u: number, v: number): [number, number] => [jx + u * c - v * s, jz + u * s + v * c];
        if (pitched) {
          pitchedRoofs.push(jx, h, jz, rot, w * 1.04, 0.7, d * 1.04, vary(hexToRgb("#b5654a"), rng, 0.08));
        } else if (spec.kind === 6) {
          roofCaps.push(jx, h, jz, rot, w * 1.02, 0.08, d * 1.02, vary(hexToRgb(rng.pick(PALETTES.industrialRoof)), rng, 0.05));
        } else if (spec.kind === 3 || spec.kind === 5) {
          roofCaps.push(jx, h, jz, rot, w * 0.94, 0.12, d * 0.94, [0.55, 0.58, 0.6]);
          const [px, pz] = local(rng.range(-w / 5, w / 5), rng.range(-d / 5, d / 5));
          stairRooms.push(px, h, pz, rot, w * 0.35, 0.5, d * 0.3, [0.72, 0.74, 0.76]);
        } else {
          if (rng.chance(0.7)) {
            const n = rng.chance(0.3) ? 2 : 1;
            for (let i = 0; i < n; i++) {
              const [px, pz] = local(rng.range(-w / 3, w / 3), rng.range(-d / 3, d / 3));
              const r = rng.range(0.16, 0.24);
              tanks.push(px, h, pz, 0, r, rng.range(0.28, 0.4), r, rng.chance(0.85) ? [0.13, 0.13, 0.14] : [0.85, 0.85, 0.8]);
            }
          }
          if (rng.chance(0.45)) {
            const [px, pz] = local(rng.range(-w / 4, w / 4), rng.range(-d / 4, d / 4));
            stairRooms.push(px, h, pz, rot, rng.range(0.5, 0.8), 0.45, rng.range(0.45, 0.7), [col[0] * 0.96, col[1] * 0.96, col[2] * 0.96]);
          }
        }
    }
  }

  // Trees.
  const treesRound = new PropBuilder();
  const treesTall = new PropBuilder();
  const greens = ["#7fa35a", "#6d9450", "#8bb065", "#5f8a4a", "#93b46c", "#78a05c"];
  const addTree = (x: number, z: number, scale: number, tall = false) => {
    const c = vary(hexToRgb(rng.pick(greens)), rng, 0.08);
    if (tall) treesTall.push(x, 0, z, rng.next() * Math.PI, scale * 0.6, scale * 1.5, scale * 0.6, c);
    else treesRound.push(x, 0, z, rng.next() * Math.PI, scale, scale * rng.range(0.85, 1.1), scale, c);
  };

  // Park interiors (skip Lodhi's paths and lawns of the central vista centre).
  for (const f of FOOTPRINTS) {
    if (f.kind !== "park" || !f.rect) continue;
    const r = f.rect;
    const isVista = f.id === "kartavya-lawns";
    const pitch = isVista ? 3 : 2.1;
    for (let z = r.z0 + 0.8; z <= r.z1 - 0.8; z += pitch) {
      for (let x = r.x0 + 0.8; x <= r.x1 - 0.8; x += pitch) {
        if (isVista) {
          // Rows of trees framing the lawns.
          const dz = Math.min(Math.abs(z - r.z0), Math.abs(z - r.z1));
          if (dz > 2.2) continue;
        }
        const jx = x + (rng.next() - 0.5) * 1.2;
        const jz = z + (rng.next() - 0.5) * 1.2;
        if (grid.get(jx, jz) !== Occ.Park) continue;
        if (f.id === "lodhi" && isLodhiPath(jx, jz)) continue;
        if (!isVista && rng.chance(0.22)) continue;
        addTree(jx, jz, rng.range(0.85, 1.3), !isVista && rng.chance(0.15));
      }
    }
  }
  // Avenue trees on sidewalks.
  for (const road of ARTERIALS) {
    if (road.kind === "market") continue;
    const lush = (x: number, z: number) => {
      const reg = regionAt(x, z);
      return reg === "central" || reg === "south" ? 0.85 : reg === "east" ? 0.45 : 0.3;
    };
    for (const [a, b] of roadSegments(road)) {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const ux = (b[0] - a[0]) / len;
      const uz = (b[1] - a[1]) / len;
      const off = road.width / 2 + 0.75;
      for (let t = 1; t < len; t += 3.1) {
        for (const side of [-1, 1]) {
          const x = a[0] + ux * t + uz * off * side;
          const z = a[1] + uz * t - ux * off * side;
          if (grid.get(x, z) !== Occ.Sidewalk) continue;
          if (!rng.chance(lush(x, z))) continue;
          addTree(x, z, rng.range(0.6, 0.85));
        }
      }
    }
  }
  // Residential gaps and river banks.
  grid.forBox(WORLD.minX + 1, WORLD.maxX - 1, WORLD.minZ + 1, WORLD.maxZ - 1, (x, z, k) => {
    if ((Math.floor(x * 2) + Math.floor(z * 2) * 7) % 3 !== 0) return;
    const v = grid.data[k];
    if (v === Occ.Free || v === Occ.Yard) {
      const reg = regionAt(x, z);
      const p = v === Occ.Yard ? 0.4 : reg === "south" ? 0.16 : reg === "central" ? 0.16 : reg === "east" ? 0.08 : reg === "industrial" ? 0.03 : 0.02;
      if (rng.chance(p)) addTree(x + (rng.next() - 0.5) * 0.3, z + (rng.next() - 0.5) * 0.3, rng.range(0.55, 0.9), rng.chance(0.2));
    } else if (v === Occ.Bank) {
      const d = riverDistance(x, z);
      if (d > RIVER_HALF_WIDTH + 1.3 && rng.chance(0.09)) addTree(x, z, rng.range(0.6, 1.0));
    }
  });

  // Street lamps along arterials.
  const lamps = new PropBuilder();
  for (const road of ARTERIALS) {
    for (const [a, b] of roadSegments(road)) {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const ux = (b[0] - a[0]) / len;
      const uz = (b[1] - a[1]) / len;
      const off = road.width / 2 + 0.35;
      for (let t = 2.5; t < len; t += 6.5) {
        for (const side of [-1, 1]) {
          const x = a[0] + ux * t + uz * off * side;
          const z = a[1] + uz * t - ux * off * side;
          const v = grid.get(x, z);
          if (v !== Occ.Sidewalk && v !== Occ.Road) continue;
          if (riverDistance(x, z) < RIVER_HALF_WIDTH + RIVER_BANK + 1) continue;
          // Arm points toward the road.
          // Local +X (the lamp arm) points back toward the carriageway.
          lamps.push(x, 0, z, Math.atan2(ux * side, -uz * side), 1, 1, 1);
        }
      }
    }
  }

  // Signals at arterial crossings.
  const signals: { x: number; z: number }[] = [];
  const sigRoads = ARTERIALS.filter((r) => r.signalised);
  for (let i = 0; i < sigRoads.length; i++) {
    for (let j = i + 1; j < sigRoads.length; j++) {
      for (const [a, b] of roadSegments(sigRoads[i])) {
        for (const [c, d] of roadSegments(sigRoads[j])) {
          const p = segIntersect(a, b, c, d);
          if (!p) continue;
          if (riverDistance(p[0], p[1]) < RIVER_HALF_WIDTH + RIVER_BANK + 3) continue;
          if (Math.abs(p[0]) > WORLD.maxX - 3 || Math.abs(p[1]) > WORLD.maxZ - 3) continue;
          if (signals.some((s) => Math.hypot(s.x - p[0], s.z - p[1]) < 3)) continue;
          signals.push({ x: p[0], z: p[1] });
        }
      }
    }
  }
  const crosswalks = new PropBuilder();
  for (const s of signals) {
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const off = 3.1;
      const cx = s.x + dx * off;
      const cz = s.z + dz * off;
      if (grid.get(cx, cz) !== Occ.Road) continue;
      for (let k = -3; k <= 3; k++) {
        const along = k * 0.42;
        crosswalks.push(cx + (dz !== 0 ? along : 0), 0.05, cz + (dx !== 0 ? along : 0), dx !== 0 ? 0 : Math.PI / 2, 0.9, 1, 0.2);
      }
    }
  }

  // Parked vehicles: lots and residential kerbs.
  const parkedCars = new PropBuilder();
  const parkedBuses = new PropBuilder();
  const parkedTrucks = new PropBuilder();
  const busColors = ["#3f8f5b", "#e07b2e", "#c8432f", "#3f8f5b"];
  const truckColors = ["#d9542c", "#2e6fa3", "#e2b331", "#3b8a4f", "#c43c3c"];
  const DIMS = { car: [1.0, 0.5], bus: [2.4, 0.62], truck: [1.9, 0.62] } as const;
  const fillLot = (
    x0: number, x1: number, z0: number, z1: number,
    kind: "car" | "bus" | "truck", fill: number, orient: "x" | "z",
  ) => {
    const [len, wid] = DIMS[kind];
    const target = kind === "car" ? parkedCars : kind === "bus" ? parkedBuses : parkedTrucks;
    const palette = kind === "car" ? CAR_COLORS : kind === "bus" ? busColors : truckColors;
    const stepX = orient === "z" ? wid + 0.28 : len + 0.3;
    const stepZ = orient === "z" ? len + 1.1 : wid + 0.5;
    const extZ = orient === "z" ? len : wid;
    for (let z = z0 + extZ / 2 + 0.1; z <= z1 - extZ / 2; z += stepZ) {
      for (let x = x0 + stepX / 2; x <= x1 - stepX / 2; x += stepX) {
        if (!rng.chance(fill)) continue;
        const rot = (orient === "z" ? Math.PI / 2 : 0) + (rng.chance(0.5) ? Math.PI : 0);
        target.push(x, 0, z, rot, 1, 1, 1, hexToRgb(rng.pick(palette)));
      }
    }
  };
  fillLot(-41, -29, -85.5, -79.5, "bus", 0.8, "z");
  fillLot(100, 112, 11, 16, "bus", 0.85, "z");
  fillLot(-107, -93, 44, 53.5, "truck", 0.85, "z");
  fillLot(-9, 13, -39.2, -38.0, "car", 0.9, "x");
  fillLot(40, 52, 46.5, 49.5, "car", 0.8, "z");
  for (const st of streets) {
    const reg = regionAt(st.points[0][0], st.points[0][1]);
    if (reg === "industrial") continue;
    const [a, b] = st.points;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const ux = (b[0] - a[0]) / len;
    const uz = (b[1] - a[1]) / len;
    const off = st.width / 2 - 0.28;
    for (let t = 2; t < len - 2; t += 1.35) {
      if (!rng.chance(reg === "old" ? 0.1 : 0.16)) continue;
      const side = rng.chance(0.5) ? 1 : -1;
      parkedCars.push(
        a[0] + ux * t + uz * off * side,
        0,
        a[1] + uz * t - ux * off * side,
        Math.atan2(-uz, ux),
        0.85,
        0.85,
        0.85,
        hexToRgb(rng.pick(CAR_COLORS)),
      );
    }
  }

  // Market stalls along Chandni Chowk and a few old-city lanes.
  const stalls = new PropBuilder();
  const awnings = ["#d9534f", "#f0ad4e", "#5bc0de", "#e8e2d0", "#8e44ad", "#f39c12", "#2e86ab", "#c0392b", "#27ae60"];
  for (let x = -20; x < 32; x += 0.85) {
    for (const side of [-1, 1]) {
      if (rng.chance(0.15)) continue;
      const z = -71 + side * 1.75;
      if (grid.get(x, z) === Occ.Reserved) continue;
      stalls.push(x, 0, z, 0, 0.75, rng.range(0.38, 0.5), 0.75, hexToRgb(rng.pick(awnings)));
    }
  }

  const toSet = <T extends number>(arr: T[]) => new Float32Array(arr);
  return {
    streets,
    roads,
    buildings: {
      count: B.x.length,
      x: toSet(B.x), z: toSet(B.z), w: toSet(B.w), d: toSet(B.d), h: toSet(B.h), rot: toSet(B.rot),
      color: toSet(B.color), style: toSet(B.style), kind: new Uint8Array(B.kind), region: B.region,
      pitched: new Uint8Array(B.pitched),
    },
    tanks: tanks.build(),
    stairRooms: stairRooms.build(),
    roofCaps: roofCaps.build(),
    pitchedRoofs: pitchedRoofs.build(),
    treesRound: treesRound.build(),
    treesTall: treesTall.build(),
    lamps: lamps.build(),
    parkedCars: parkedCars.build(),
    parkedBuses: parkedBuses.build(),
    parkedTrucks: parkedTrucks.build(),
    stalls: stalls.build(),
    signals,
    crosswalks: crosswalks.build(),
    grid: { data: grid.data, width: GW, height: GH, cell: CELL },
  };
}

function segIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): Vec2 | null {
  const r = [b[0] - a[0], b[1] - a[1]];
  const s = [d[0] - c[0], d[1] - c[1]];
  const den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den;
  const u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return [a[0] + t * r[0], a[1] + t * r[1]];
}

/** Curving footpaths through Lodhi Garden (shared with the ground painter). */
export const LODHI_PATHS: Vec2[][] = [
  [[5.5, 22], [10, 21], [15, 23.5], [20, 22], [26, 24], [30.5, 23]],
  [[12, 18.5], [13, 23], [11.5, 28], [14, 33.5]],
  [[24, 18.5], [22.5, 24], [25, 29], [23, 33.5]],
  [[5.5, 30], [11, 29], [17, 31], [24, 30], [30.5, 31]],
];

function isLodhiPath(x: number, z: number) {
  for (const path of LODHI_PATHS) {
    for (let i = 0; i < path.length - 1; i++) {
      if (segDist(x, z, path[i][0], path[i][1], path[i + 1][0], path[i + 1][1]) < 1) return true;
    }
  }
  // Pond.
  return Math.hypot(x - 17, z - 26.5) < 3.4;
}
