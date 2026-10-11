import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

type Part = { geo: THREE.BufferGeometry; color: string; at?: [number, number, number]; rot?: [number, number, number] };

/** Merge primitive parts into one vertex-coloured, indexed geometry. */
export function mergeParts(parts: Part[]): THREE.BufferGeometry {
  const geos = parts.map(({ geo, color, at, rot }) => {
    // Polyhedra are non-indexed while boxes/cylinders are indexed; normalise.
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (g !== geo) geo.dispose();
    if (rot) {
      g.rotateX(rot[0]);
      g.rotateY(rot[1]);
      g.rotateZ(rot[2]);
    }
    if (at) g.translate(at[0], at[1], at[2]);
    const c = new THREE.Color(color);
    const n = g.getAttribute("position").count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      arr[i * 3] = c.r;
      arr[i * 3 + 1] = c.g;
      arr[i * 3 + 2] = c.b;
    }
    g.setAttribute("color", new THREE.BufferAttribute(arr, 3));
    // Keep attribute sets identical for merging.
    if (!g.getAttribute("uv")) g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    return g;
  });
  const merged = mergeGeometries(geos, false);
  geos.forEach((g) => g.dispose());
  if (!merged) throw new Error("Failed to merge geometry parts");
  return merged;
}

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const wheel = (r = 0.09, w = 0.08) => new THREE.CylinderGeometry(r, r, w, 10);
const W = "#ffffff";
const GLASS = "#3a4652";
const TYRE = "#1d1f22";

function wheels(xs: number[], z: number, r = 0.09): Part[] {
  const parts: Part[] = [];
  for (const x of xs) {
    for (const s of [-1, 1]) parts.push({ geo: wheel(r), color: TYRE, at: [x, r, s * z], rot: [Math.PI / 2, 0, 0] });
  }
  return parts;
}

export interface VehicleGeometry {
  body: THREE.BufferGeometry;
  lights: THREE.BufferGeometry;
  length: number;
}

function lightsFor(len: number, y: number, z: number, single = false): THREE.BufferGeometry {
  const parts: Part[] = [];
  const zs = single ? [0] : [-z, z];
  for (const s of zs) {
    parts.push({ geo: box(0.03, 0.06, 0.1), color: "#fff6d8", at: [len / 2 + 0.01, y, s] });
    parts.push({ geo: box(0.03, 0.05, 0.09), color: "#ff3b30", at: [-len / 2 - 0.01, y, s] });
  }
  return mergeParts(parts);
}

export function createVehicleGeometries(): Record<"car" | "auto" | "bus" | "truck" | "van", VehicleGeometry> {
  return {
    car: {
      length: 1.0,
      body: mergeParts([
        { geo: box(1.0, 0.24, 0.5), color: W, at: [0, 0.2, 0] },
        { geo: box(0.56, 0.2, 0.46), color: GLASS, at: [-0.06, 0.42, 0] },
        { geo: box(0.5, 0.03, 0.44), color: W, at: [-0.06, 0.535, 0] },
        ...wheels([-0.32, 0.32], 0.24),
      ]),
      lights: lightsFor(1.0, 0.22, 0.17),
    },
    auto: {
      length: 0.66,
      body: mergeParts([
        { geo: box(0.64, 0.2, 0.42), color: "#2f8f4e", at: [0, 0.2, 0] },
        { geo: box(0.48, 0.2, 0.44), color: "#f2c230", at: [-0.04, 0.42, 0] },
        { geo: box(0.2, 0.18, 0.38), color: GLASS, at: [0.2, 0.39, 0] },
        { geo: wheel(0.08), color: TYRE, at: [0.26, 0.08, 0], rot: [Math.PI / 2, 0, 0] },
        ...wheels([-0.2], 0.21, 0.08),
      ]),
      lights: lightsFor(0.66, 0.24, 0, true),
    },
    bus: {
      length: 2.4,
      body: mergeParts([
        { geo: box(2.4, 0.5, 0.6), color: W, at: [0, 0.37, 0] },
        { geo: box(2.3, 0.16, 0.62), color: GLASS, at: [0, 0.5, 0] },
        { geo: box(0.05, 0.3, 0.5), color: GLASS, at: [1.19, 0.45, 0] },
        { geo: box(0.9, 0.07, 0.4), color: "#dfe3e6", at: [0.2, 0.655, 0] },
        ...wheels([-0.8, 0.8], 0.26, 0.11),
      ]),
      lights: lightsFor(2.4, 0.28, 0.22),
    },
    truck: {
      length: 1.9,
      body: mergeParts([
        { geo: box(0.5, 0.44, 0.58), color: W, at: [0.68, 0.34, 0] },
        { geo: box(0.06, 0.18, 0.5), color: GLASS, at: [0.94, 0.44, 0] },
        { geo: box(1.3, 0.58, 0.62), color: "#efe3c8", at: [-0.25, 0.43, 0] },
        ...wheels([-0.6, -0.2, 0.68], 0.27, 0.1),
      ]),
      lights: lightsFor(1.9, 0.26, 0.2),
    },
    van: {
      length: 1.1,
      body: mergeParts([
        { geo: box(1.1, 0.46, 0.52), color: W, at: [0, 0.32, 0] },
        { geo: box(0.08, 0.2, 0.48), color: GLASS, at: [0.53, 0.44, 0] },
        { geo: box(0.4, 0.16, 0.53), color: GLASS, at: [0.25, 0.44, 0] },
        ...wheels([-0.34, 0.34], 0.24),
      ]),
      lights: lightsFor(1.1, 0.24, 0.18),
    },
  };
}

export function createTreeGeometries() {
  const round = mergeParts([
    { geo: new THREE.CylinderGeometry(0.07, 0.1, 0.8, 5), color: "#7a6048", at: [0, 0.4, 0] },
    { geo: new THREE.IcosahedronGeometry(0.75, 0), color: W, at: [0, 1.25, 0] },
    { geo: new THREE.IcosahedronGeometry(0.5, 0), color: "#e8f0dc", at: [0.3, 1.55, 0.2] },
  ]);
  const tall = mergeParts([
    { geo: new THREE.CylinderGeometry(0.06, 0.08, 0.6, 5), color: "#7a6048", at: [0, 0.3, 0] },
    { geo: new THREE.ConeGeometry(0.55, 1.8, 7), color: W, at: [0, 1.4, 0] },
  ]);
  return { round, tall };
}

export function unitBox(): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(1, 1, 1);
  g.translate(0, 0.5, 0);
  return g;
}

export function unitCylinder(segments = 10): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(1, 1, 1, segments);
  g.translate(0, 0.5, 0);
  return g;
}

/** Triangular prism, ridge along X, base 1×1 at y = 0, apex at y = 1. */
export function unitPrism(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-0.5, 0);
  shape.lineTo(0.5, 0);
  shape.lineTo(0, 1);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false });
  g.translate(0, 0, -0.5);
  g.rotateY(Math.PI / 2);
  return g;
}

export function createLampGeometry() {
  const pole = mergeParts([
    { geo: new THREE.CylinderGeometry(0.03, 0.045, 1.6, 5), color: "#5d656e", at: [0, 0.8, 0] },
    { geo: box(0.48, 0.035, 0.035), color: "#5d656e", at: [0.22, 1.58, 0] },
  ]);
  const head = new THREE.BoxGeometry(0.18, 0.05, 0.11);
  head.translate(0.44, 1.55, 0);
  return { pole, head };
}

export function createStallGeometry() {
  return mergeParts([
    { geo: box(0.7, 0.04, 0.62), color: W, at: [0, 0.62, 0], rot: [0.18, 0, 0] },
    { geo: box(0.62, 0.32, 0.46), color: "#d8c7a8", at: [0, 0.16, 0] },
    { geo: box(0.03, 0.62, 0.03), color: "#55504a", at: [0.32, 0.31, 0.28] },
    { geo: box(0.03, 0.62, 0.03), color: "#55504a", at: [-0.32, 0.31, 0.28] },
  ]);
}

/** Write a TRS matrix (Y rotation only) straight into an instance matrix array. */
export function writeMatrix(
  arr: Float32Array | number[],
  i: number,
  x: number,
  y: number,
  z: number,
  rotY: number,
  sx: number,
  sy: number,
  sz: number,
) {
  const c = Math.cos(rotY);
  const s = Math.sin(rotY);
  const o = i * 16;
  arr[o] = c * sx;
  arr[o + 1] = 0;
  arr[o + 2] = -s * sx;
  arr[o + 3] = 0;
  arr[o + 4] = 0;
  arr[o + 5] = sy;
  arr[o + 6] = 0;
  arr[o + 7] = 0;
  arr[o + 8] = s * sz;
  arr[o + 9] = 0;
  arr[o + 10] = c * sz;
  arr[o + 11] = 0;
  arr[o + 12] = x;
  arr[o + 13] = y;
  arr[o + 14] = z;
  arr[o + 15] = 1;
}
