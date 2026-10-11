import type { GeoPoint, RouteKind, RoutingProviderId, TravelMode } from "../../../../types/api";

export interface RouteRequest {
  fromZoneId: string;
  toZoneId: string;
  origin: GeoPoint;
  destination: GeoPoint;
  mode: TravelMode;
  plannedZoneIds: string[];
}

/** A routable path before pollution scoring. */
export interface RouteCandidate {
  routeId: string;
  kind: RouteKind;
  provider: RoutingProviderId;
  /** [lon, lat] pairs. */
  geometry: [number, number][];
  distanceMeters: number;
  durationSeconds: number;
  isDemo: boolean;
}

export interface RoutingProvider {
  readonly id: RoutingProviderId;
  candidates(request: RouteRequest): Promise<RouteCandidate[]>;
}

export class RoutingUnavailableError extends Error {}
