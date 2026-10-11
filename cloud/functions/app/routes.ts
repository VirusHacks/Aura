/**
 * Route alternatives: candidates from the configured provider (Amazon Location
 * or the demo zone graph), each scored against the scenario readings. Amazon
 * Location calls cost money, so they are rate-limited per user; over the limit
 * or on any provider failure the demo provider answers, clearly labelled.
 */
import { DOMAIN_EVENTS, type RouteComparison, type TravelMode } from "../../../types/api";
import { effectiveThresholdAqi } from "../domain/alerts";
import { readingsByZone, scenarioLabel } from "../domain/city";
import { compareRoutes } from "../domain/routing/compare";
import { scoreRoute } from "../domain/routing/scoring";
import { RoutingUnavailableError } from "../domain/routing/types";
import { badRequest } from "../shared/errors";
import { metric } from "../shared/log";
import * as v from "../shared/validation";
import { domainEvent } from "../services/events";
import { type AppContext, activeScenario, loadCity } from "./context";
import { type ApiRequest, type AuthUser, type Route, ok } from "./http";
import { preferencesFor } from "./trips";

/** Amazon Location route requests allowed per user per hour. */
export const ROUTE_REQUESTS_PER_HOUR = 30;

export async function routeComparison(
  ctx: AppContext,
  user: AuthUser,
  input: { fromZoneId: string; toZoneId: string; mode: TravelMode; plannedZoneIds: string[]; tripId: string | null },
  correlationId: string,
): Promise<RouteComparison | null> {
  const now = ctx.clock();
  const city = await loadCity(ctx);
  const from = city.byId.get(input.fromZoneId) ?? badRequest(`Unknown zone ${input.fromZoneId}`);
  const to = city.byId.get(input.toZoneId) ?? badRequest(`Unknown zone ${input.toZoneId}`);
  if (!from.geo || !to.geo) badRequest("Zone has no geographic anchor");
  const scenario = await activeScenario(ctx, now);
  const readings = readingsByZone(city, scenario);
  const aqi = new Map([...readings].map(([k, r]) => [k, r.aqi]));
  const prefs = await preferencesFor(ctx, user.userId);

  // Start from the trip's current point when known (dashboard or GPS), else the zone anchor.
  let origin = from.geo!;
  if (input.tripId && ctx.trips) {
    const trip = await ctx.trips.get(user.userId, input.tripId);
    if (trip?.currentWorld && trip.currentZoneId === input.fromZoneId && city.projection) origin = city.projection.toGeo(trip.currentWorld);
  }

  let provider = ctx.routing(city, aqi);
  if (provider.id === "amazon-location" && ctx.users && !(await ctx.users.allow(user.userId, "routes", ROUTE_REQUESTS_PER_HOUR, 3600, now))) {
    metric("RouteRateLimited");
    provider = ctx.fallbackRouting(city, aqi);
  }
  const request = { fromZoneId: from.id, toZoneId: to.id, origin, destination: to.geo!, mode: input.mode, plannedZoneIds: input.plannedZoneIds };
  let candidates;
  try {
    candidates = await provider.candidates(request);
    metric("RouteRequests", 1, { Provider: provider.id });
    if (candidates.length === 0) throw new RoutingUnavailableError("No routes returned");
  } catch (err) {
    metric("RouteFailures", 1, { Provider: provider.id });
    ctx.log.warn("Routing provider failed; using the demo zone graph", { provider: provider.id, error: (err as Error).message });
    provider = ctx.fallbackRouting(city, aqi);
    candidates = await provider.candidates(request);
  }
  // The planned route (zone graph) is the reference "current" route when it exists.
  if (provider.id === "amazon-location" && input.plannedZoneIds.length) {
    const planned = (await ctx.fallbackRouting(city, aqi).candidates(request)).filter((c) => c.kind === "planned");
    candidates = [...planned, ...candidates];
  }
  const threshold = effectiveThresholdAqi(prefs);
  const scored = candidates.map((c) => scoreRoute(c, city, readings, threshold));
  const comparison = compareRoutes({
    city,
    scored,
    fromZoneId: from.id,
    toZoneId: to.id,
    mode: input.mode,
    provider: provider.id,
    scenarioLabel: scenarioLabel(scenario),
    now,
  });
  if (comparison && input.tripId) {
    await ctx.events.publish([
      domainEvent(DOMAIN_EVENTS.RouteAlternativesGenerated, {
        userId: user.userId,
        correlationId,
        tripId: input.tripId,
        now,
        payload: { comparison },
      }),
    ]);
  }
  return comparison;
}

async function compare(req: ApiRequest & { user: AuthUser }, ctx: AppContext) {
  const body = v.object(req.body);
  const comparison = await routeComparison(
    ctx,
    req.user,
    {
      fromZoneId: v.id(body.fromZoneId, "fromZoneId"),
      toZoneId: v.id(body.toZoneId, "toZoneId"),
      mode: v.optionalOneOf(body.mode, v.TRAVEL_MODES, "walk"),
      plannedZoneIds: v.zoneIds(body.plannedZoneIds, "plannedZoneIds"),
      tripId: v.optionalId(body.tripId, "tripId"),
    },
    req.correlationId,
  );
  return comparison ? ok(comparison) : ok({ error: "No route between those zones", code: "not-found" }, 404);
}

export const routeRoutes: Route[] = [{ method: "POST", path: "/v1/routes/compare", auth: true, handler: compare }];
