/**
 * Turns a reported position into a zone match, a reading and an alert decision.
 * Mirrors TripEvaluator.swift, plus world-point positions from the dashboard.
 */
import { locateGeo, locateWorld } from "../../../lib/geo";
import type { AlertPreferences, LocationPayload, Scenario, SuppressionReason, ZoneMatch, ZoneReadingV1 } from "../../../types/api";
import { badRequest, outsideCoverage } from "../shared/errors";
import { type AlertDecision, type AlertHistoryEntry, evaluateAlert } from "./alerts";
import { type City, zoneReading } from "./city";
import type { TripRecord } from "./trips";

/**
 * Accepted positions, in order of precedence:
 * 1. `geo` — a GPS fix (must be within coverage unless simulated with a fallback);
 * 2. `world` — a point on the 3D city, only for simulated positions;
 * 3. `zoneId` — a zone centre, only for simulated positions.
 */
export function resolveLocation(city: City, location: LocationPayload): ZoneMatch {
  const zones = city.dataset.zones;
  if (location.geo) {
    const result = locateGeo(zones, location.geo, city.projection);
    if (result.inside) return result.match;
    if (!location.simulated || (!location.world && !location.zoneId)) {
      const { nearestZoneName: name, distanceKm: km } = result;
      outsideCoverage(`Outside Delhi coverage${name ? ` (nearest: ${name}, ${Math.round(km ?? 0)} km)` : ""}`);
    }
  }
  if (location.world) {
    if (!location.simulated) badRequest("World positions are accepted only for simulated movement");
    const result = locateWorld(zones, location.world, city.projection);
    if (result.inside) return result.match;
    if (!location.zoneId) outsideCoverage(`Outside the modelled city (nearest: ${result.nearestZoneName ?? "none"})`);
  }
  if (location.zoneId) {
    if (!location.simulated) badRequest("Zone positions are accepted only for simulated movement");
    const zone = city.byId.get(location.zoneId) ?? badRequest(`Unknown zone ${location.zoneId}`);
    return { zoneId: zone.id, zoneName: zone.name, distanceKm: 0, world: { x: zone.position[0], z: zone.position[1] } };
  }
  return badRequest("No position supplied");
}

export interface PositionEvaluation {
  match: ZoneMatch;
  reading: ZoneReadingV1;
  upcoming: ZoneReadingV1 | null;
  decision: AlertDecision;
}

export function evaluatePosition(input: {
  city: City;
  scenario: Scenario;
  location: LocationPayload;
  prefs: AlertPreferences;
  trip: Pick<TripRecord, "phase" | "plannedZoneIds"> | null;
  history: AlertHistoryEntry[];
  dataAsOf: Date;
  now: Date;
}): PositionEvaluation {
  const { city, scenario } = input;
  const match = resolveLocation(city, input.location);
  const zone = city.byId.get(match.zoneId)!;
  const reading = zoneReading(zone, scenario, city.dataset.provenance);
  const planned = input.trip?.plannedZoneIds ?? [];
  const i = planned.indexOf(zone.id);
  const nextZone = i >= 0 && i + 1 < planned.length ? city.byId.get(planned[i + 1]) : undefined;
  const upcoming = nextZone ? zoneReading(nextZone, scenario, city.dataset.provenance) : null;
  const decision = evaluateAlert(
    { reading, dataAsOf: input.dataAsOf, upcoming, tripPhase: input.trip?.phase ?? null, history: input.history, now: input.now },
    input.prefs,
  );
  return { match, reading, upcoming, decision };
}

export const suppressionOf = (d: AlertDecision): SuppressionReason | null => ("suppress" in d ? d.suppress : null);
