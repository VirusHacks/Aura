/**
 * Demo routing provider: shortest and least-exposure paths over the zone
 * adjacency graph (the same planner as RoutePlanner.swift). Paths run between
 * zone anchors, so they are schematic and always labelled `isDemo`.
 */
import { distanceKm } from "../../../../lib/geo";
import type { TravelMode } from "../../../../types/api";
import type { City } from "../city";
import type { RouteCandidate, RouteRequest, RoutingProvider } from "./types";

export const ROAD_FACTOR = 1.3;
export const MODE_SPEED_KMH: Record<TravelMode, number> = { walk: 4.8, cycle: 14, motor: 20 };

export function adjacency(city: City): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const [a, b] of city.links) {
    if (a === b || !city.byId.has(a) || !city.byId.has(b)) continue;
    adj.set(a, [...(adj.get(a) ?? []), b]);
    adj.set(b, [...(adj.get(b) ?? []), a]);
  }
  return adj;
}

export function makeZoneGraph(city: City, aqiByZone: Map<string, number>) {
  const adj = adjacency(city);
  const segmentKm = (a: string, b: string): number | null => {
    const ga = city.byId.get(a)?.geo;
    const gb = city.byId.get(b)?.geo;
    return ga && gb ? distanceKm(ga, gb) * ROAD_FACTOR : null;
  };
  const segmentExposure = (a: string, b: string): number | null => {
    const km = segmentKm(a, b);
    const qa = aqiByZone.get(a);
    const qb = aqiByZone.get(b);
    return km === null || qa === undefined || qb === undefined ? null : (km * (qa + qb)) / 2;
  };

  /** Dijkstra with deterministic tie-breaking on zone id. */
  function path(start: string, goal: string, by: "distance" | "exposure"): string[] | null {
    if (!city.byId.has(start) || !city.byId.has(goal)) return null;
    if (start === goal) return [start];
    const dist = new Map<string, number>([[start, 0]]);
    const prev = new Map<string, string>();
    const visited = new Set<string>();
    for (;;) {
      let current: [string, number] | null = null;
      for (const [zid, d] of dist) {
        if (visited.has(zid)) continue;
        if (!current || d < current[1] || (d === current[1] && zid < current[0])) current = [zid, d];
      }
      if (!current) return null;
      if (current[0] === goal) break;
      visited.add(current[0]);
      for (const next of [...(adj.get(current[0]) ?? [])].sort()) {
        if (visited.has(next)) continue;
        const w = by === "exposure" ? segmentExposure(current[0], next) : segmentKm(current[0], next);
        if (w === null) continue;
        const candidate = current[1] + w;
        if (candidate < (dist.get(next) ?? Infinity)) {
          dist.set(next, candidate);
          prev.set(next, current[0]);
        }
      }
    }
    const result = [goal];
    while (prev.has(result[0])) result.unshift(prev.get(result[0])!);
    return result[0] === start ? result : null;
  }

  /** True when consecutive zones are linked. */
  const isConnected = (zoneIds: string[]) => zoneIds.every((z, i) => i === 0 || (adj.get(zoneIds[i - 1]) ?? []).includes(z));

  return { path, segmentKm, isConnected };
}

export class ZoneGraphRoutingProvider implements RoutingProvider {
  readonly id = "demo-zone-graph" as const;

  constructor(
    private readonly city: City,
    private readonly aqiByZone: Map<string, number>,
  ) {}

  async candidates(req: RouteRequest): Promise<RouteCandidate[]> {
    const graph = makeZoneGraph(this.city, this.aqiByZone);
    const out: RouteCandidate[] = [];
    const add = (zoneIds: string[] | null, kind: RouteCandidate["kind"]) => {
      if (!zoneIds || out.some((c) => c.routeId.endsWith(zoneIds.join(">")))) return;
      const geometry = zoneIds.map((z) => {
        const g = this.city.byId.get(z)!.geo!;
        return [g.lon, g.lat] as [number, number];
      });
      let km = 0;
      for (let i = 1; i < zoneIds.length; i++) km += graph.segmentKm(zoneIds[i - 1], zoneIds[i]) ?? 0;
      out.push({
        routeId: `${kind}:${zoneIds.join(">")}`,
        kind,
        provider: this.id,
        geometry,
        distanceMeters: Math.round(km * 1000),
        durationSeconds: Math.max(60, Math.round((km / MODE_SPEED_KMH[req.mode]) * 3600)),
        isDemo: true,
      });
    };
    const i = req.plannedZoneIds.indexOf(req.fromZoneId);
    const remainder = i >= 0 ? req.plannedZoneIds.slice(i) : null;
    if (remainder && remainder.at(-1) === req.toZoneId && graph.isConnected(remainder)) add(remainder, "planned");
    add(graph.path(req.fromZoneId, req.toZoneId, "distance"), "fastest");
    add(graph.path(req.fromZoneId, req.toZoneId, "exposure"), "cleaner");
    return out;
  }
}
