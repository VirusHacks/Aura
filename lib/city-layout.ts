/**
 * Stylised, schematic layout of the simulated Delhi. Positions are chosen for
 * legibility and relative arrangement only — they are NOT survey accurate.
 *
 * World units: 1 unit ≈ 4.5 m. +X is east, −Z is north.
 */
import type { RegionId } from "../types/air-quality";
import type { Circle, Footprint, Rect, RoadDef, Vec2 } from "../types/scene";

export const WORLD = { minX: -135, maxX: 135, minZ: -105, maxZ: 105 } as const;
export const WORLD_WIDTH = WORLD.maxX - WORLD.minX;
export const WORLD_DEPTH = WORLD.maxZ - WORLD.minZ;

// ─── Yamuna ────────────────────────────────────────────────────────────────
export const RIVER_HALF_WIDTH = 6;
export const RIVER_BANK = 3.5;

/** Centreline x of the Yamuna at a given z. */
export function riverX(z: number): number {
  return 72 + 3 * Math.sin(z * 0.028 + 0.6) + 1.5 * Math.sin(z * 0.07);
}

export function riverDistance(x: number, z: number): number {
  return Math.abs(x - riverX(z));
}

/** Height of the road deck where roads cross the river (bridges). */
export function deckHeight(x: number, z: number): number {
  const d = riverDistance(x, z);
  const inner = RIVER_HALF_WIDTH + RIVER_BANK;
  if (d <= inner) return BRIDGE_DECK;
  if (d >= inner + BRIDGE_RAMP) return 0;
  // Linear ramp so vehicles sit exactly on the rendered ramp boxes.
  return BRIDGE_DECK * (1 - (d - inner) / BRIDGE_RAMP);
}

export const BRIDGE_DECK = 0.45;
export const BRIDGE_RAMP = 3;

// ─── Key anchors ───────────────────────────────────────────────────────────
export const ANCHORS = {
  indiaGate: [20, 8] as Vec2,
  connaught: [2, -14] as Vec2,
  redFort: [45, -71] as Vec2,
  jamaMasjid: [20, -60] as Vec2,
  qutub: [-12.5, 86] as Vec2,
  lotus: [46, 86] as Vec2,
  ndls: [2, -41.5] as Vec2,
  rashtrapati: [-36.5, 8] as Vec2,
  lodhi: [18, 26] as Vec2,
  signatureBridgeZ: -76,
  railwayZ: -48.5,
  metroDeckY: 4.6,
} as const;

export const CP = {
  center: ANCHORS.connaught,
  innerPark: 6,
  innerRoad: [6, 7.6] as const,
  innerBlock: [8, 10.8] as const,
  middleRoad: [11, 12.6] as const,
  outerBlock: [13, 15.4] as const,
  outerRoad: [15.6, 17.2] as const,
};

// ─── Ring road ─────────────────────────────────────────────────────────────
export const RING = { x0: -46, x1: 56, z0: -90, z1: 68, r: 12, width: 4.4 };

function roundedRect(x0: number, x1: number, z0: number, z1: number, r: number, seg = 6): Vec2[] {
  const pts: Vec2[] = [];
  const corner = (cx: number, cz: number, a0: number) => {
    for (let i = 0; i <= seg; i++) {
      const a = a0 + (i / seg) * (Math.PI / 2);
      pts.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
    }
  };
  // Clockwise when viewed from above with −Z north: NW → NE → SE → SW.
  corner(x0 + r, z0 + r, Math.PI);
  corner(x1 - r, z0 + r, -Math.PI / 2);
  corner(x1 - r, z1 - r, 0);
  corner(x0 + r, z1 - r, Math.PI / 2);
  return pts;
}

/** A straight road that bends around the given circles (roundabouts, CP). */
function straightWithDetours(a: Vec2, b: Vec2, detours: Circle[], step = 1): Vec2[] {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len = Math.hypot(dx, dz);
  const ux = dx / len;
  const uz = dz / len;
  // Normal pointing to the left of travel (north for eastbound roads).
  const nx = uz;
  const nz = -ux;
  const pts: Vec2[] = [];
  const n = Math.ceil(len / step);
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * len;
    let x = a[0] + ux * t;
    let z = a[1] + uz * t;
    for (const c of detours) {
      const along = (c.x - a[0]) * ux + (c.z - a[1]) * uz;
      const off = t - along;
      if (Math.abs(off) < c.r) {
        const lateral = (x - c.x) * nx + (z - c.z) * nz;
        const push = Math.sqrt(c.r * c.r - off * off) - lateral;
        x += nx * push;
        z += nz * push;
      }
    }
    pts.push([x, z]);
  }
  // Drop points that are nearly collinear so traffic paths stay light.
  return simplify(pts, 0.02);
}

function simplify(pts: Vec2[], tolerance: number): Vec2[] {
  if (pts.length < 3) return pts;
  const out: Vec2[] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const p = out[out.length - 1];
    const q = pts[i];
    const r = pts[i + 1];
    const cross = (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    if (Math.abs(cross) > tolerance) out.push(q);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

const IG_ROUNDABOUT: Circle = { x: ANCHORS.indiaGate[0], z: ANCHORS.indiaGate[1], r: 7.6 };
const CP_OUTER: Circle = { x: CP.center[0], z: CP.center[1], r: 16.4 };

export const ARTERIALS: RoadDef[] = [
  {
    id: "ring",
    name: "Ring Road",
    kind: "ring",
    width: RING.width,
    points: roundedRect(RING.x0, RING.x1, RING.z0, RING.z1, RING.r),
    closed: true,
    density: 1,
    signalised: true,
  },
  {
    id: "a1",
    name: "Vikas Marg – Minto Road corridor",
    kind: "arterial",
    width: 3.4,
    points: [[WORLD.minX, -36], [WORLD.maxX, -36]],
    density: 0.9,
    signalised: true,
  },
  {
    id: "a2",
    name: "Kartavya Path – ITO axis",
    kind: "arterial",
    width: 3.4,
    points: straightWithDetours([WORLD.minX, 8], [WORLD.maxX, 8], [IG_ROUNDABOUT]),
    density: 0.85,
    signalised: true,
  },
  {
    id: "a3",
    name: "Lodhi Road – NH-24 link",
    kind: "arterial",
    width: 3.4,
    points: [[WORLD.minX, 40], [WORLD.maxX, 40]],
    density: 0.8,
    signalised: true,
  },
  {
    id: "a0",
    name: "Signature Bridge approach",
    kind: "arterial",
    width: 3.4,
    points: [[RING.x1, ANCHORS.signatureBridgeZ], [WORLD.maxX, ANCHORS.signatureBridgeZ]],
    density: 0.55,
    signalised: true,
  },
  {
    id: "a4",
    name: "Aurobindo Marg",
    kind: "arterial",
    width: 3.4,
    points: [[-22, WORLD.minZ], [-22, WORLD.maxZ]],
    density: 0.85,
    signalised: true,
  },
  {
    id: "a5",
    name: "Janpath – Chelmsford Road",
    kind: "arterial",
    width: 3.4,
    points: straightWithDetours([2, WORLD.maxZ], [2, WORLD.minZ], [CP_OUTER]),
    density: 0.75,
    signalised: true,
  },
  {
    id: "a6",
    name: "Mathura Road – Netaji Subhash Marg",
    kind: "arterial",
    width: 3.4,
    points: [[34, WORLD.minZ], [34, WORLD.maxZ]],
    density: 0.8,
    signalised: true,
  },
  {
    id: "a7",
    name: "Swami Dayanand Marg",
    kind: "arterial",
    width: 3.4,
    points: [[96, WORLD.minZ], [96, WORLD.maxZ]],
    density: 0.85,
    signalised: true,
  },
  {
    id: "a8",
    name: "Road No. 56",
    kind: "arterial",
    width: 3.4,
    points: [[116, WORLD.minZ], [116, WORLD.maxZ]],
    density: 0.7,
    signalised: true,
  },
  {
    id: "a9",
    name: "Najafgarh Road link",
    kind: "arterial",
    width: 3.4,
    points: [[-80, WORLD.minZ], [-80, WORLD.maxZ]],
    density: 0.7,
    signalised: true,
    mix: "freight",
  },
  {
    id: "a10",
    name: "Outer Ring Road (west)",
    kind: "arterial",
    width: 3.4,
    points: [[-110, WORLD.minZ], [-110, WORLD.maxZ]],
    density: 0.65,
    signalised: true,
    mix: "freight",
  },
  {
    id: "a11",
    name: "Mayur Vihar link road",
    kind: "arterial",
    width: 3.4,
    points: [[86, 72], [WORLD.maxX, 72]],
    density: 0.5,
    signalised: true,
  },
  {
    id: "nh48",
    name: "NH-48 Expressway",
    kind: "highway",
    width: 5.2,
    points: [[WORLD.minX, 98], [-49, 42]],
    density: 1,
    signalised: false,
    mix: "freight",
  },
  {
    id: "cp-east",
    name: "Barakhamba Road",
    kind: "arterial",
    width: 2.8,
    points: [[CP.center[0] + 17, CP.center[1]], [34, CP.center[1]]],
    density: 0.5,
    signalised: false,
  },
  {
    id: "cp-west",
    name: "Panchkuian Road",
    kind: "arterial",
    width: 2.8,
    points: [[-22, CP.center[1]], [CP.center[0] - 17, CP.center[1]]],
    density: 0.5,
    signalised: false,
  },
  {
    id: "chandni",
    name: "Chandni Chowk",
    kind: "market",
    width: 2.4,
    points: [[-22, -71], [34, -71]],
    density: 0.6,
    signalised: false,
    mix: "market",
  },
];

// ─── Footprints (parks, landmarks, plazas, sites) ──────────────────────────
const rect = (x0: number, x1: number, z0: number, z1: number): Rect => ({ x0, x1, z0, z1 });

export const FOOTPRINTS: Footprint[] = [
  // Central
  { id: "cp", kind: "landmark", circle: { x: CP.center[0], z: CP.center[1], r: 17.6 } },
  { id: "india-gate", kind: "park", circle: { x: IG_ROUNDABOUT.x, z: IG_ROUNDABOUT.z, r: 9.6 } },
  { id: "kartavya-lawns", kind: "park", rect: rect(-20, 12, 1, 15) },
  { id: "rashtrapati", kind: "landmark", rect: rect(-43, -29, 0, 16) },
  { id: "ndls-yard", kind: "rail", rect: rect(-20, 24, -53.5, -43.6) },
  { id: "ndls-station", kind: "landmark", rect: rect(-10, 14, -43.6, -39.2) },
  { id: "park-central-w", kind: "park", rect: rect(-36, -28, -29, -19) },
  // Old Delhi
  { id: "red-fort", kind: "landmark", rect: rect(36.5, 53, -83.5, -58.5) },
  { id: "jama-masjid", kind: "landmark", rect: rect(14.5, 25.5, -65.5, -54.5) },
  { id: "isbt-kg", kind: "lot", rect: rect(-42, -28, -86, -76) },
  { id: "park-old", kind: "park", rect: rect(-8, 0, -86, -78) },
  // South
  { id: "lodhi", kind: "park", rect: rect(5, 31, 18, 34) },
  { id: "qutub", kind: "landmark", rect: rect(-19, -6, 78, 94) },
  { id: "lotus", kind: "landmark", circle: { x: ANCHORS.lotus[0], z: ANCHORS.lotus[1], r: 8.5 } },
  { id: "aiims", kind: "landmark", rect: rect(-18, -5, 43, 53) },
  { id: "school", kind: "landmark", rect: rect(9, 22, 48.5, 60) },
  { id: "nehru-place", kind: "plaza", rect: rect(39, 53, 46, 62) },
  { id: "site-hk", kind: "site", rect: rect(-16, -6, 56, 63.5) },
  { id: "park-south-1", kind: "park", rect: rect(-38, -29, 48, 57) },
  { id: "park-south-2", kind: "park", rect: rect(18, 29, 76, 85) },
  // East
  { id: "isbt-av", kind: "lot", rect: rect(99, 113, 10.5, 20) },
  { id: "site-ln", kind: "site", rect: rect(101, 112, -53, -44) },
  { id: "sahibabad", kind: "landmark", rect: rect(119.5, 134, 23, 36.5) },
  { id: "ghazipur", kind: "landfill", circle: { x: 127, z: 89, r: 7 } },
  { id: "park-east-1", kind: "park", rect: rect(86, 94, 44, 52) },
  { id: "park-east-2", kind: "park", rect: rect(102, 110, -68, -60) },
  // Industrial
  { id: "mayapuri", kind: "landmark", rect: rect(-101, -82, -32, -12) },
  { id: "site-ow", kind: "site", rect: rect(-76, -54, -90, -66) },
  { id: "truck-lot", kind: "lot", rect: rect(-108, -92, 43, 54) },
];

// ─── Queries ───────────────────────────────────────────────────────────────
export function inRect(x: number, z: number, r: Rect, margin = 0): boolean {
  return x >= r.x0 - margin && x <= r.x1 + margin && z >= r.z0 - margin && z <= r.z1 + margin;
}

export function inCircle(x: number, z: number, c: Circle, margin = 0): boolean {
  const dx = x - c.x;
  const dz = z - c.z;
  const r = c.r + margin;
  return dx * dx + dz * dz <= r * r;
}

export function inFootprint(x: number, z: number, f: Footprint, margin = 0): boolean {
  if (f.rect) return inRect(x, z, f.rect, margin);
  if (f.circle) return inCircle(x, z, f.circle, margin);
  return false;
}

export function distToSegment(px: number, pz: number, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const l2 = dx * dx + dz * dz;
  let t = l2 === 0 ? 0 : ((px - a[0]) * dx + (pz - a[1]) * dz) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (a[0] + t * dx), pz - (a[1] + t * dz));
}

export function distToPolyline(px: number, pz: number, pts: Vec2[], closed = false): number {
  let d = Infinity;
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    d = Math.min(d, distToSegment(px, pz, pts[i], pts[(i + 1) % pts.length]));
  }
  return d;
}

export function inWorld(x: number, z: number, margin = 0): boolean {
  return (
    x >= WORLD.minX + margin &&
    x <= WORLD.maxX - margin &&
    z >= WORLD.minZ + margin &&
    z <= WORLD.maxZ - margin
  );
}

export function isRiver(x: number, z: number, margin = 0): boolean {
  return riverDistance(x, z) < RIVER_HALF_WIDTH + RIVER_BANK + margin;
}

export function isRailCorridor(x: number, z: number, margin = 0): boolean {
  return Math.abs(z - ANCHORS.railwayZ) < 1.8 + margin;
}

/** Old-city / central / south split along the main ring, east of the river, industrial west. */
export function regionAt(x: number, z: number): RegionId {
  if (x > 60) return "east";
  if (x < -48) return "industrial";
  if (z < -54) return "old";
  if (z > 17) return "south";
  return "central";
}

export const REGION_BOUNDS: Record<RegionId, Rect> = {
  central: rect(-48, 60, -54, 17),
  old: rect(-48, 60, WORLD.minZ, -54),
  south: rect(-48, 60, 17, WORLD.maxZ),
  east: rect(60, WORLD.maxX, WORLD.minZ, WORLD.maxZ),
  industrial: rect(WORLD.minX, -48, WORLD.minZ, WORLD.maxZ),
};
