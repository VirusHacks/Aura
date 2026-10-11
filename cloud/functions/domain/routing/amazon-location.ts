/**
 * Amazon Location Service routes (Routes V2 `CalculateRoutes`). Real road
 * geometry and travel times; AEROSCOPE then scores each candidate against the
 * zone readings. There is no bicycle travel mode, so cycling uses `Scooter`
 * (documented assumption: similar speeds and road access in Delhi).
 */
import { CalculateRoutesCommand, type CalculateRoutesCommandOutput, GeoRoutesClient } from "@aws-sdk/client-geo-routes";
import type { TravelMode } from "../../../../types/api";
import type { RouteCandidate, RouteRequest, RoutingProvider } from "./types";
import { RoutingUnavailableError } from "./types";

const TRAVEL_MODE: Record<TravelMode, "Pedestrian" | "Scooter" | "Car"> = { walk: "Pedestrian", cycle: "Scooter", motor: "Car" };

export interface GeoRoutesSender {
  send(command: CalculateRoutesCommand): Promise<CalculateRoutesCommandOutput>;
}

export class AmazonLocationRoutingProvider implements RoutingProvider {
  readonly id = "amazon-location" as const;
  private readonly client: GeoRoutesSender;

  constructor(client?: GeoRoutesSender, private readonly maxAlternatives = 2) {
    this.client = client ?? new GeoRoutesClient({ maxAttempts: 2 });
  }

  async candidates(req: RouteRequest): Promise<RouteCandidate[]> {
    let res: CalculateRoutesCommandOutput;
    try {
      res = await this.client.send(
        new CalculateRoutesCommand({
          Origin: [req.origin.lon, req.origin.lat],
          Destination: [req.destination.lon, req.destination.lat],
          TravelMode: TRAVEL_MODE[req.mode],
          MaxAlternatives: this.maxAlternatives,
          LegGeometryFormat: "Simple",
          LegAdditionalFeatures: ["Summary"],
          DepartNow: true,
        }),
      );
    } catch (err) {
      throw new RoutingUnavailableError(`Amazon Location: ${(err as Error).name ?? "request failed"}`);
    }
    return (res.Routes ?? []).flatMap((route, index): RouteCandidate[] => {
      const geometry: [number, number][] = [];
      let legMeters = 0;
      let legSeconds = 0;
      for (const leg of route.Legs ?? []) {
        for (const p of leg.Geometry?.LineString ?? []) {
          if (p.length >= 2) geometry.push([p[0], p[1]]);
        }
        const s = leg.PedestrianLegDetails?.Summary?.Overview ?? leg.VehicleLegDetails?.Summary?.Overview;
        legMeters += s?.Distance ?? 0;
        legSeconds += s?.Duration ?? 0;
      }
      if (geometry.length < 2) return [];
      const distanceMeters = route.Summary?.Distance ?? legMeters;
      const durationSeconds = route.Summary?.Duration ?? legSeconds;
      if (!distanceMeters || !durationSeconds) return [];
      return [
        {
          routeId: `loc:${req.fromZoneId}>${req.toZoneId}:${index}`,
          kind: index === 0 ? "fastest" : "cleaner",
          provider: this.id,
          geometry,
          distanceMeters: Math.round(distanceMeters),
          durationSeconds: Math.round(durationSeconds),
          isDemo: false,
        },
      ];
    });
  }
}
