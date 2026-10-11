/**
 * Paints the city ground (land-use tints, parks, lawns, plazas, lots, sites,
 * river banks) into a canvas texture. Browser-only.
 */
import * as THREE from "three";
import { LODHI_PATHS } from "./city-generator";
import {
  ANCHORS,
  CP,
  FOOTPRINTS,
  REGION_BOUNDS,
  RIVER_BANK,
  RIVER_HALF_WIDTH,
  WORLD,
  WORLD_DEPTH,
  WORLD_WIDTH,
  riverX,
} from "./city-layout";
import { createRng } from "./rng";
import type { RegionId } from "../types/air-quality";

const PX_PER_UNIT = 8;

const REGION_TINT: Record<RegionId, string> = {
  central: "#e9e3d6",
  old: "#e7dccb",
  south: "#e5e3d3",
  east: "#e6e0d3",
  industrial: "#dedad2",
};

export function createGroundTexture(maxSize = 2160): THREE.CanvasTexture {
  const scale = Math.min(PX_PER_UNIT, maxSize / WORLD_WIDTH);
  const W = Math.round(WORLD_WIDTH * scale);
  const H = Math.round(WORLD_DEPTH * scale);
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const X = (x: number) => (x - WORLD.minX) * scale;
  const Z = (z: number) => (z - WORLD.minZ) * scale;
  const S = (u: number) => u * scale;
  const rng = createRng(7);

  // Region tints.
  for (const [id, r] of Object.entries(REGION_BOUNDS) as [RegionId, (typeof REGION_BOUNDS)[RegionId]][]) {
    ctx.fillStyle = REGION_TINT[id];
    ctx.fillRect(X(r.x0), Z(r.z0), S(r.x1 - r.x0), S(r.z1 - r.z0));
  }

  // Fine speckle so large surfaces don't read as flat plastic.
  for (let i = 0; i < 26000; i++) {
    const x = rng.next() * W;
    const y = rng.next() * H;
    const a = rng.range(0.025, 0.06);
    ctx.fillStyle = rng.chance(0.5) ? `rgba(120,105,80,${a})` : `rgba(255,255,255,${a})`;
    ctx.fillRect(x, y, rng.range(1, 3), rng.range(1, 3));
  }

  // River banks (sandy floodplain with scrub) and the water bed.
  for (let z = WORLD.minZ; z <= WORLD.maxZ; z += 0.5) {
    const cx = riverX(z);
    const bank = RIVER_HALF_WIDTH + RIVER_BANK;
    ctx.fillStyle = "#d8cfae";
    ctx.fillRect(X(cx - bank), Z(z), S(bank * 2), S(0.6));
    ctx.fillStyle = "#b9c48f";
    ctx.fillRect(X(cx - bank), Z(z), S(1.6), S(0.6));
    ctx.fillRect(X(cx + bank - 1.6), Z(z), S(1.6), S(0.6));
    ctx.fillStyle = "#5f8e98";
    ctx.fillRect(X(cx - RIVER_HALF_WIDTH), Z(z), S(RIVER_HALF_WIDTH * 2), S(0.6));
  }

  const lawn = (x0: number, z0: number, w: number, d: number, stripes = true) => {
    ctx.fillStyle = "#b8cf8c";
    ctx.fillRect(X(x0), Z(z0), S(w), S(d));
    if (stripes) {
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      for (let x = x0; x < x0 + w; x += 1.6) ctx.fillRect(X(x), Z(z0), S(0.8), S(d));
    }
  };
  const circle = (x: number, z: number, r: number, fill: string) => {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(X(x), Z(z), S(r), 0, Math.PI * 2);
    ctx.fill();
  };
  const stone = "#ece5d6";

  for (const f of FOOTPRINTS) {
    const r = f.rect;
    switch (f.kind) {
      case "park":
        if (r) lawn(r.x0, r.z0, r.x1 - r.x0, r.z1 - r.z0);
        break;
      case "site":
        if (r) {
          ctx.fillStyle = "#cdb58d";
          ctx.fillRect(X(r.x0), Z(r.z0), S(r.x1 - r.x0), S(r.z1 - r.z0));
          ctx.strokeStyle = "rgba(110,85,55,0.25)";
          ctx.lineWidth = S(0.35);
          for (let i = 0; i < 8; i++) {
            ctx.beginPath();
            ctx.moveTo(X(r.x0 + rng.next() * (r.x1 - r.x0)), Z(r.z0));
            ctx.bezierCurveTo(
              X(r.x0 + rng.next() * (r.x1 - r.x0)), Z(r.z0 + (r.z1 - r.z0) * 0.4),
              X(r.x0 + rng.next() * (r.x1 - r.x0)), Z(r.z0 + (r.z1 - r.z0) * 0.6),
              X(r.x0 + rng.next() * (r.x1 - r.x0)), Z(r.z1),
            );
            ctx.stroke();
          }
        }
        break;
      case "lot":
        if (r) {
          ctx.fillStyle = "#b9b6af";
          ctx.fillRect(X(r.x0), Z(r.z0), S(r.x1 - r.x0), S(r.z1 - r.z0));
          ctx.fillStyle = "rgba(255,255,255,0.55)";
          for (let x = r.x0 + 0.6; x < r.x1; x += 1.05) ctx.fillRect(X(x), Z(r.z0 + 0.4), S(0.06), S(r.z1 - r.z0 - 0.8));
        }
        break;
      case "rail":
        if (r) {
          ctx.fillStyle = "#aaa196";
          ctx.fillRect(X(r.x0), Z(r.z0), S(r.x1 - r.x0), S(r.z1 - r.z0));
        }
        break;
      case "plaza":
        if (r) {
          ctx.fillStyle = stone;
          ctx.fillRect(X(r.x0), Z(r.z0), S(r.x1 - r.x0), S(r.z1 - r.z0));
        }
        break;
      case "landfill":
        if (f.circle) circle(f.circle.x, f.circle.z, f.circle.r + 1.5, "#bfae8f");
        break;
      case "landmark":
        if (r) {
          ctx.fillStyle = stone;
          ctx.fillRect(X(r.x0), Z(r.z0), S(r.x1 - r.x0), S(r.z1 - r.z0));
        }
        break;
    }
  }

  // Mainline railway ballast.
  ctx.fillStyle = "#b0a698";
  ctx.fillRect(0, Z(ANCHORS.railwayZ - 1.6), W, S(3.2));

  // Central vista: lawns and canals.
  lawn(-20, 1, 32, 14);
  ctx.fillStyle = "#8fb8c4";
  ctx.fillRect(X(-19), Z(3.2), S(30), S(0.9));
  ctx.fillRect(X(-19), Z(11.9), S(30), S(0.9));
  // India Gate hexagon plaza inside the roundabout.
  circle(ANCHORS.indiaGate[0], ANCHORS.indiaGate[1], 9.6, "#b8cf8c");
  ctx.fillStyle = stone;
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    const px = X(ANCHORS.indiaGate[0] + Math.cos(a) * 5.4);
    const pz = Z(ANCHORS.indiaGate[1] + Math.sin(a) * 5.4);
    if (i === 0) ctx.moveTo(px, pz);
    else ctx.lineTo(px, pz);
  }
  ctx.closePath();
  ctx.fill();

  // Rashtrapati Bhavan forecourt and gardens.
  lawn(-43, 0, 14, 16);
  ctx.fillStyle = stone;
  ctx.fillRect(X(-31), Z(6), S(11), S(4));

  // Connaught Place: central park and paved block rings.
  circle(CP.center[0], CP.center[1], CP.outerRoad[1] + 0.4, stone);
  circle(CP.center[0], CP.center[1], CP.innerPark, "#b3cc86");
  circle(CP.center[0], CP.center[1], 1.4, stone);

  // Red Fort lawns inside the walls.
  lawn(38, -82, 13.5, 22);
  ctx.fillStyle = "#c9b48f";
  ctx.fillRect(X(36.5), Z(-72), S(2.5), S(2.5));
  // Jama Masjid courtyard.
  ctx.fillStyle = "#d9c3a5";
  ctx.fillRect(X(14.5), Z(-65.5), S(11), S(11));

  // Lodhi Garden paths and pond.
  ctx.strokeStyle = "#e3d2ad";
  ctx.lineWidth = S(0.9);
  ctx.lineCap = "round";
  for (const path of LODHI_PATHS) {
    ctx.beginPath();
    path.forEach(([x, z], i) => (i === 0 ? ctx.moveTo(X(x), Z(z)) : ctx.lineTo(X(x), Z(z))));
    ctx.stroke();
  }
  circle(17, 26.5, 3.2, "#7fb0bb");
  circle(17, 26.5, 2.6, "#6fa3b0");

  // Qutub complex lawns, Lotus temple pools, school sports field.
  lawn(-19, 78, 13, 16);
  ctx.fillStyle = "#d9c7a8";
  ctx.fillRect(X(-16), Z(83), S(7), S(6));
  circle(ANCHORS.lotus[0], ANCHORS.lotus[1], 8.5, "#b8cf8c");
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    circle(ANCHORS.lotus[0] + Math.cos(a) * 5.6, ANCHORS.lotus[1] + Math.sin(a) * 5.6, 1.2, "#86b9c6");
  }
  circle(ANCHORS.lotus[0], ANCHORS.lotus[1], 4.2, stone);
  ctx.fillStyle = "#a9c47e";
  ctx.fillRect(X(9.5), Z(54), S(12), S(5.5));
  ctx.strokeStyle = "rgba(255,255,255,0.8)";
  ctx.lineWidth = S(0.18);
  ctx.strokeRect(X(10.3), Z(54.8), S(10.4), S(3.9));
  ctx.fillStyle = "#e9e4d6";
  ctx.fillRect(X(-18), Z(43), S(13), S(10));
  // Nehru Place parking strip.
  ctx.fillStyle = "#bdb9b1";
  ctx.fillRect(X(39.5), Z(46.3), S(13), S(3.4));

  // Industrial yards and the truck park.
  ctx.fillStyle = "#cfcac0";
  ctx.fillRect(X(-101), Z(-32), S(19), S(20));

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

/** Soft radial shadow texture used under the slab and as glow sprites. */
export function createRadialTexture(inner = "rgba(0,0,0,0.5)", outer = "rgba(0,0,0,0)", size = 128): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
