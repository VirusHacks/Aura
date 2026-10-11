/**
 * Geography for the schematic city: WGS84 ↔ ground-plane projection and zone
 * matching. Zone matching for GPS fixes is the same as watch/AeroscopeKit
 * Geo.swift (nearest anchor within 5 km).
 *
 * The 3D city is schematic, not to scale, so a plain affine fit misplaces zones
 * by tens of world units. The projection is the affine fit plus an
 * inverse-distance-weighted correction from the zone anchors: exact at every
 * anchor and smooth between them, in both directions.
 */
import { ZONE_GEO } from "../data/delhi-geo";
import type { GeoPoint, WorldPoint, ZoneMatch } from "../types/api";

/** A zone as far as geography is concerned. */
export interface GeoZone {
  id: string;
  name: string;
  position: [number, number];
  radius: number;
  geo?: GeoPoint;
}

/** A fix farther than this from every zone anchor is outside Delhi coverage. */
export const COVERAGE_RADIUS_KM = 5;

export function distanceKm(a: GeoPoint, b: GeoPoint): number {
  const r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r;
  const dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Attaches the bundled anchor to every zone that lacks one. */
export function withGeo<Z extends Omit<GeoZone, "geo"> & { geo?: GeoPoint }>(zones: readonly Z[]): (Z & { geo?: GeoPoint })[] {
  return zones.map((z) => (z.geo || !ZONE_GEO[z.id] ? z : { ...z, geo: ZONE_GEO[z.id] }));
}

function solve3(m: number[][], v: number[]): number[] | null {
  const a = m.map((row) => [...row]);
  const b = [...v];
  for (let col = 0; col < 3; col++) {
    let pivot = col;
    for (let r = col + 1; r < 3; r++) if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
    if (Math.abs(a[pivot][col]) < 1e-12) return null;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    [b[col], b[pivot]] = [b[pivot], b[col]];
    for (let r = col + 1; r < 3; r++) {
      const f = a[r][col] / a[col][col];
      for (let c = col; c < 3; c++) a[r][c] -= f * a[col][c];
      b[r] -= f * b[col];
    }
  }
  const x = [0, 0, 0];
  for (let r = 2; r >= 0; r--) {
    let s = b[r];
    for (let c = r + 1; c < 3; c++) s -= a[r][c] * x[c];
    x[r] = s / a[r][r];
  }
  return x;
}

const round1 = (v: number) => Math.round(v * 10) / 10;

/** Least-squares affine map between coordinates and the 3D city, both ways. */
export interface CityProjection {
  toWorld(p: GeoPoint): WorldPoint;
  toGeo(w: WorldPoint): GeoPoint;
}

export function makeProjection(zones: readonly GeoZone[]): CityProjection | null {
  const anchors = zones.filter((z): z is GeoZone & { geo: GeoPoint } => Boolean(z.geo));
  if (anchors.length < 3) return null;
  const latMean = anchors.reduce((s, z) => s + z.geo.lat, 0) / anchors.length;
  const lonMean = anchors.reduce((s, z) => s + z.geo.lon, 0) / anchors.length;
  const rows = anchors.map((z) => [1, z.geo.lat - latMean, z.geo.lon - lonMean]);
  const fit = (targets: number[]) => {
    const ata = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    const atb = [0, 0, 0];
    rows.forEach((row, k) => {
      for (let i = 0; i < 3; i++) {
        atb[i] += row[i] * targets[k];
        for (let j = 0; j < 3; j++) ata[i][j] += row[i] * row[j];
      }
    });
    return solve3(ata, atb);
  };
  const xc = fit(anchors.map((z) => z.position[0]));
  const zc = fit(anchors.map((z) => z.position[1]));
  if (!xc || !zc) return null;
  const det = xc[1] * zc[2] - xc[2] * zc[1];
  if (Math.abs(det) < 1e-12) return null;

  const affineWorld = (p: GeoPoint): WorldPoint => {
    const dLat = p.lat - latMean;
    const dLon = p.lon - lonMean;
    return { x: xc[0] + xc[1] * dLat + xc[2] * dLon, z: zc[0] + zc[1] * dLat + zc[2] * dLon };
  };
  const affineGeo = (w: WorldPoint): GeoPoint => {
    const rx = w.x - xc[0];
    const rz = w.z - zc[0];
    return { lat: latMean + (rx * zc[2] - xc[2] * rz) / det, lon: lonMean + (xc[1] * rz - zc[1] * rx) / det };
  };
  // Residuals the affine fit leaves at each anchor, in both spaces.
  const worldResidual = anchors.map((a) => {
    const w = affineWorld(a.geo);
    return { x: a.position[0] - w.x, z: a.position[1] - w.z };
  });
  const geoResidual = anchors.map((a) => {
    const g = affineGeo({ x: a.position[0], z: a.position[1] });
    return { lat: a.geo.lat - g.lat, lon: a.geo.lon - g.lon };
  });
  /** Inverse-square weights; an exact hit on an anchor takes that anchor's residual. */
  const weights = (d2: number[]) => {
    const hit = d2.findIndex((d) => d < 1e-18);
    if (hit >= 0) return d2.map((_, i) => (i === hit ? 1 : 0));
    const w = d2.map((d) => 1 / d);
    const sum = w.reduce((s, v) => s + v, 0);
    return w.map((v) => v / sum);
  };
  const kmScale = Math.cos((latMean * Math.PI) / 180);

  const worldRaw = (p: GeoPoint): WorldPoint => {
    const base = affineWorld(p);
    const w = weights(anchors.map((a) => (a.geo.lat - p.lat) ** 2 + ((a.geo.lon - p.lon) * kmScale) ** 2));
    return {
      x: base.x + w.reduce((s, wi, i) => s + wi * worldResidual[i].x, 0),
      z: base.z + w.reduce((s, wi, i) => s + wi * worldResidual[i].z, 0),
    };
  };

  return {
    toWorld(p) {
      const w = worldRaw(p);
      return { x: round1(w.x), z: round1(w.z) };
    },
    toGeo(pt) {
      // Start from the mirrored correction, then refine so toWorld(toGeo(w)) ≈ w.
      const base = affineGeo(pt);
      const w = weights(anchors.map((a) => (a.position[0] - pt.x) ** 2 + (a.position[1] - pt.z) ** 2));
      let g = {
        lat: base.lat + w.reduce((s, wi, i) => s + wi * geoResidual[i].lat, 0),
        lon: base.lon + w.reduce((s, wi, i) => s + wi * geoResidual[i].lon, 0),
      };
      // Damped Newton steps with the affine Jacobian; a step is kept only if it
      // reduces the error, so warped parts of the schematic map can't diverge.
      const err = (q: GeoPoint) => {
        const b = worldRaw(q);
        return { ex: pt.x - b.x, ez: pt.z - b.z, n: Math.hypot(pt.x - b.x, pt.z - b.z) };
      };
      let e = err(g);
      for (let i = 0; i < 12 && e.n > 0.01; i++) {
        const step = { lat: (e.ex * zc[2] - xc[2] * e.ez) / det, lon: (xc[1] * e.ez - zc[1] * e.ex) / det };
        let improved = false;
        for (let t = 1; t >= 1 / 64; t /= 2) {
          const candidate = { lat: g.lat + step.lat * t, lon: g.lon + step.lon * t };
          const ce = err(candidate);
          if (ce.n < e.n) {
            g = candidate;
            e = ce;
            improved = true;
            break;
          }
        }
        if (!improved) break;
      }
      return { lat: Math.round(g.lat * 1e6) / 1e6, lon: Math.round(g.lon * 1e6) / 1e6 };
    },
  };
}

export type LocateResult =
  | { inside: true; match: ZoneMatch }
  | { inside: false; nearestZoneName: string | null; distanceKm: number | null };

/** Nearest zone anchor to a GPS fix, or outside coverage. */
export function locateGeo(zones: readonly GeoZone[], point: GeoPoint, projection = makeProjection(zones)): LocateResult {
  let nearest: { zone: GeoZone; km: number } | null = null;
  for (const zone of zones) {
    if (!zone.geo) continue;
    const km = distanceKm(point, zone.geo);
    if (!nearest || km < nearest.km) nearest = { zone, km };
  }
  if (!nearest) return { inside: false, nearestZoneName: null, distanceKm: null };
  if (nearest.km > COVERAGE_RADIUS_KM) return { inside: false, nearestZoneName: nearest.zone.name, distanceKm: nearest.km };
  return {
    inside: true,
    match: {
      zoneId: nearest.zone.id,
      zoneName: nearest.zone.name,
      distanceKm: Math.round(nearest.km * 1000) / 1000,
      world: projection ? projection.toWorld(point) : null,
    },
  };
}

/**
 * Zone for a point on the 3D city (the dashboard's simulated walk). The zone
 * whose centre is nearest relative to its radius wins, so walking across a
 * boundary changes zone where the heatmap shows the change.
 */
export function locateWorld(zones: readonly GeoZone[], point: WorldPoint, projection = makeProjection(zones)): LocateResult {
  let best: { zone: GeoZone; score: number; d: number } | null = null;
  for (const zone of zones) {
    const d = Math.hypot(point.x - zone.position[0], point.z - zone.position[1]);
    const score = d / Math.max(1, zone.radius);
    if (!best || score < best.score) best = { zone, score, d };
  }
  if (!best) return { inside: false, nearestZoneName: null, distanceKm: null };
  const geo = projection?.toGeo(point) ?? null;
  const km = geo && best.zone.geo ? distanceKm(geo, best.zone.geo) : 0;
  // Well outside every zone's radius is off the modelled city.
  if (best.score > 4) return { inside: false, nearestZoneName: best.zone.name, distanceKm: km };
  return {
    inside: true,
    match: { zoneId: best.zone.id, zoneName: best.zone.name, distanceKm: Math.round(km * 1000) / 1000, world: { x: round1(point.x), z: round1(point.z) } },
  };
}
