/**
 * Builds a route comparison from scored candidates. The current route is the
 * planned one (or the fastest); an alternative is offered only when it cuts
 * AQI-minutes by at least MIN_REDUCTION_PERCENT and covers the same share of
 * known zones — one low sample is never enough to call a route cleaner.
 */
import type { RouteAlternative, RouteComparison, RouteOption, RoutingProviderId, TravelMode } from "../../../../types/api";
import type { City } from "../city";
import { SCORING_METHODOLOGY, exposureOf } from "./scoring";

export const MIN_REDUCTION_PERCENT = 10;
/** An alternative must have at least this share of its time in known zones. */
export const MIN_KNOWN_SHARE = 0.6;

function knownShare(r: RouteAlternative): number {
  return r.estimatedDurationSeconds > 0 ? 1 - r.unknownSeconds / r.estimatedDurationSeconds : 0;
}

export function toRouteOption(r: RouteAlternative, city: City): RouteOption {
  const names = r.zoneIds.map((z) => city.byId.get(z)?.name ?? z);
  const peak = r.zoneSummaries.reduce<RouteAlternative["zoneSummaries"][number] | null>((p, z) => (!p || z.aqi > p.aqi ? z : p), null);
  return {
    id: r.routeId,
    kind: r.kind,
    zoneIds: r.zoneIds,
    zoneNames: names,
    distanceKm: Math.round(r.distanceMeters / 100) / 10,
    durationMinutes: Math.max(1, Math.round(r.estimatedDurationSeconds / 60)),
    averageAqi: r.routeAQIScore ?? 0,
    peakAqi: peak?.aqi ?? 0,
    peakZoneName: peak?.zoneName ?? "",
    exposureIndex: Math.round(exposureOf(r) ?? 0),
  };
}

export function compareRoutes(input: {
  city: City;
  scored: RouteAlternative[];
  fromZoneId: string;
  toZoneId: string;
  mode: TravelMode;
  provider: RoutingProviderId;
  scenarioLabel: string;
  now: Date;
}): RouteComparison | null {
  const { scored, city } = input;
  if (scored.length === 0) return null;
  const current = scored.find((r) => r.kind === "planned") ?? scored.find((r) => r.kind === "fastest") ?? scored[0];
  const currentExposure = exposureOf(current);
  let best: RouteAlternative | null = null;
  let bestPercent: number | null = null;
  for (const r of scored) {
    if (r === current || r.zoneIds.join(">") === current.zoneIds.join(">") && r.provider === "demo-zone-graph") continue;
    const e = exposureOf(r);
    if (e === null || currentExposure === null || currentExposure <= 0 || knownShare(r) < MIN_KNOWN_SHARE) continue;
    const percent = Math.round(((currentExposure - e) / currentExposure) * 100);
    if (percent >= MIN_REDUCTION_PERCENT && (bestPercent === null || percent > bestPercent)) {
      best = r;
      bestPercent = percent;
    }
  }
  const alternative = best ? { ...best, kind: "cleaner" as const } : null;
  let note: string;
  if (input.fromZoneId === input.toZoneId) note = "You have arrived.";
  else if (alternative) {
    const via = alternative.zoneIds.slice(1, -1).map((z) => city.byId.get(z)?.name ?? z);
    note = `Cleaner route${via.length ? ` via ${via.join(", ")}` : ""} cuts AQI-minutes by ${bestPercent}%.`;
  } else if (scored.length > 1) note = `Alternatives are less than ${MIN_REDUCTION_PERCENT}% cleaner. Stay on your route.`;
  else note = "Your route is already the cleanest available.";

  const ordered = [current, ...scored.filter((r) => r !== current)].map((r) => (alternative && r.routeId === alternative.routeId ? alternative : r));
  return {
    id: `cmp:${input.fromZoneId}>${input.toZoneId}:${Math.floor(input.now.getTime() / 1000)}`,
    fromZoneId: input.fromZoneId,
    toZoneId: input.toZoneId,
    mode: input.mode,
    current: toRouteOption(current, city),
    alternative: alternative ? toRouteOption(alternative, city) : null,
    exposureReductionPercent: bestPercent,
    extraMinutes: alternative ? Math.round((alternative.estimatedDurationSeconds - current.estimatedDurationSeconds) / 60) : null,
    note,
    generatedAt: input.now.toISOString(),
    scenarioLabel: input.scenarioLabel,
    alternatives: ordered,
    provider: input.provider,
    methodology: SCORING_METHODOLOGY,
    isDemo: ordered.some((r) => r.isDemo),
  };
}
