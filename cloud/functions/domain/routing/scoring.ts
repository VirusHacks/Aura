/**
 * Route pollution scoring.
 *
 * 1. Walk the route geometry in steps of at most SAMPLE_METERS.
 * 2. Assign each step to the nearest zone anchor within COVERAGE_RADIUS_KM;
 *    steps farther away are "unknown".
 * 3. Time in a zone = route duration × (metres in that zone ÷ route metres):
 *    constant speed along the route is assumed.
 * 4. routeAQIScore = Σ(seconds × zone AQI) ÷ Σ(seconds in known zones):
 *    a duration-weighted mean of the scenario AQI along the route. Unknown
 *    stretches are excluded and reported separately, never guessed.
 *
 * This compares routes under the same scenario. It is not a clinically
 * validated exposure measurement.
 */
import { getAqiCategory } from "../../../../lib/aqi";
import { distanceKm, locateGeo } from "../../../../lib/geo";
import type { RouteAlternative, ZoneExposureSummary, ZoneReadingV1 } from "../../../../types/api";
import type { City } from "../city";
import type { RouteCandidate } from "./types";

export const SAMPLE_METERS = 50;
export const MAX_GEOMETRY_POINTS = 160;

export const SCORING_METHODOLOGY =
  "Route AQI score = time-weighted mean of the scenario AQI of each zone the route passes through " +
  "(time split by distance at constant speed; zone = nearest anchor within 5 km). Stretches outside " +
  "every zone are reported as unknown and excluded. Scenario-model readings, not measurements; " +
  "for comparing routes, not a clinical exposure estimate.";

const toGeo = ([lon, lat]: [number, number]) => ({ lat, lon });

/** Ramer–Douglas–Peucker simplification on lon/lat (small-area, planar approximation). */
export function simplify(points: [number, number][], maxPoints = MAX_GEOMETRY_POINTS): [number, number][] {
  if (points.length <= maxPoints) return points;
  let epsilon = 1e-5;
  let result = points;
  while (result.length > maxPoints && epsilon < 1) {
    result = rdp(points, epsilon);
    epsilon *= 2;
  }
  return result;
}

function rdp(points: [number, number][], epsilon: number): [number, number][] {
  if (points.length < 3) return points;
  const [ax, ay] = points[0];
  const [bx, by] = points[points.length - 1];
  const len = Math.hypot(bx - ax, by - ay) || 1e-12;
  let maxD = 0;
  let index = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const [px, py] = points[i];
    const d = Math.abs((by - ay) * px - (bx - ax) * py + bx * ay - by * ax) / len;
    if (d > maxD) {
      maxD = d;
      index = i;
    }
  }
  if (maxD <= epsilon) return [points[0], points[points.length - 1]];
  return [...rdp(points.slice(0, index + 1), epsilon).slice(0, -1), ...rdp(points.slice(index), epsilon)];
}

export function scoreRoute(candidate: RouteCandidate, city: City, readings: Map<string, ZoneReadingV1>, thresholdAqi: number): RouteAlternative {
  const zones = city.dataset.zones;
  const perZone = new Map<string, { meters: number; order: number }>();
  const sequence: string[] = [];
  let unknownMeters = 0;
  let totalMeters = 0;

  const assign = (lon: number, lat: number, meters: number) => {
    totalMeters += meters;
    const located = locateGeo(zones, { lat, lon }, city.projection);
    if (!located.inside || !readings.has(located.match.zoneId)) {
      unknownMeters += meters;
      return;
    }
    const zid = located.match.zoneId;
    const entry = perZone.get(zid) ?? { meters: 0, order: perZone.size };
    entry.meters += meters;
    perZone.set(zid, entry);
    if (sequence.at(-1) !== zid) sequence.push(zid);
  };

  const g = candidate.geometry;
  for (let i = 1; i < g.length; i++) {
    const segMeters = distanceKm(toGeo(g[i - 1]), toGeo(g[i])) * 1000;
    const steps = Math.max(1, Math.ceil(segMeters / SAMPLE_METERS));
    for (let s = 0; s < steps; s++) {
      const t = (s + 0.5) / steps;
      assign(g[i - 1][0] + (g[i][0] - g[i - 1][0]) * t, g[i - 1][1] + (g[i][1] - g[i - 1][1]) * t, segMeters / steps);
    }
  }
  if (g.length === 1) assign(g[0][0], g[0][1], 0);

  const secondsPerMeter = totalMeters > 0 ? candidate.durationSeconds / totalMeters : 0;
  let aqiSeconds = 0;
  let knownSeconds = 0;
  let elevated = 0;
  const zoneSummaries: ZoneExposureSummary[] = [...perZone.entries()]
    .sort((a, b) => a[1].order - b[1].order)
    .map(([zid, { meters }]) => {
      const r = readings.get(zid)!;
      const seconds = meters * secondsPerMeter;
      aqiSeconds += seconds * r.aqi;
      knownSeconds += seconds;
      if (r.aqi >= thresholdAqi) elevated += seconds;
      return { zoneId: zid, zoneName: r.zoneName, aqi: r.aqi, category: getAqiCategory(r.aqi), seconds: Math.round(seconds), meters: Math.round(meters) };
    });

  const simplified = simplify(g);
  return {
    routeId: candidate.routeId,
    kind: candidate.kind,
    provider: candidate.provider,
    estimatedDurationSeconds: candidate.durationSeconds,
    distanceMeters: candidate.distanceMeters,
    routeAQIScore: knownSeconds > 0 ? Math.round(aqiSeconds / knownSeconds) : null,
    timeInElevatedAQIZonesSeconds: Math.round(elevated),
    unknownSeconds: Math.round(unknownMeters * secondsPerMeter),
    zoneSummaries,
    zoneIds: sequence,
    geometry: simplified,
    world: city.projection ? simplified.map(([lon, lat]) => city.projection!.toWorld({ lat, lon })) : [],
    isDemo: candidate.isDemo,
  };
}

/** AQI × minutes over the known part of the route; the quantity routes are compared on. */
export function exposureOf(r: RouteAlternative): number | null {
  return r.routeAQIScore === null ? null : (r.routeAQIScore * (r.estimatedDurationSeconds - r.unknownSeconds)) / 60;
}
