/**
 * Alert routes: history, actions (acknowledge / dismiss / request a cleaner
 * route) and a dry-run evaluation that records nothing.
 */
import { DOMAIN_EVENTS, type AlertStatus, type PollutionAlert } from "../../../types/api";
import { historyEntry } from "../domain/alerts";
import { withLabel } from "../domain/city";
import { evaluatePosition, suppressionOf } from "../domain/evaluate";
import { notFound } from "../shared/errors";
import { metric } from "../shared/log";
import * as v from "../shared/validation";
import { domainEvent } from "../services/events";
import { type AppContext, activeScenario, loadCity, need } from "./context";
import { type ApiRequest, type AuthUser, type Route, ok } from "./http";
import { routeComparison } from "./routes";
import { preferencesFor } from "./trips";

async function listAlerts(req: ApiRequest & { user: AuthUser }, ctx: AppContext) {
  const limit = v.intInRange(req.query.limit, 1, 100, 20);
  return ok({ alerts: await need(ctx.alerts, "alerts").listRecent(req.user.userId, limit) });
}

async function alertAction(req: ApiRequest & { user: AuthUser }, ctx: AppContext) {
  const body = v.object(req.body);
  const alertId = v.id(req.params.alertId, "alertId");
  const action = v.oneOf(body.action, ["acknowledge", "dismiss", "request-route"] as const, "action");
  const repo = need(ctx.alerts, "alerts");
  const alert = (await repo.get(req.user.userId, alertId)) ?? notFound("Unknown alert");
  const now = ctx.clock();
  const status: AlertStatus = action === "acknowledge" ? "acknowledged" : action === "dismiss" ? "dismissed" : "reroute-requested";
  const updated: PollutionAlert = {
    ...alert,
    status,
    updatedAt: now.toISOString(),
    acknowledgedAt: alert.acknowledgedAt ?? (action === "request-route" ? null : now.toISOString()),
  };
  await repo.save(updated);
  metric("AlertActions", 1, { Action: action });

  let comparison = null;
  if (action === "request-route" && v.isId(body.currentZoneId) && v.isId(body.destinationZoneId)) {
    comparison = await routeComparison(
      ctx,
      req.user,
      {
        fromZoneId: body.currentZoneId as string,
        toZoneId: body.destinationZoneId as string,
        mode: v.optionalOneOf(body.mode, v.TRAVEL_MODES, "walk"),
        plannedZoneIds: v.zoneIds(body.plannedZoneIds, "plannedZoneIds"),
        tripId: alert.tripId,
      },
      req.correlationId,
    );
  }
  await ctx.events.publish([
    domainEvent(DOMAIN_EVENTS.AlertUpdated, {
      userId: req.user.userId,
      correlationId: req.correlationId,
      tripId: alert.tripId,
      zoneId: alert.zoneId,
      now,
      type: action === "acknowledge" ? "alert.acknowledged" : "alert.updated",
      payload: { alert: updated },
    }),
  ]);
  return ok({ alert: updated, routeComparison: comparison });
}

/** Spec `POST /v1/alerts/evaluate`: would this position alert right now? Records nothing. */
async function evaluate(req: ApiRequest & { user: AuthUser }, ctx: AppContext) {
  const body = v.object(req.body);
  const location = v.locationPayload(body.location);
  const tripId = v.optionalId(body.tripId, "tripId");
  const now = ctx.clock();
  const city = await loadCity(ctx);
  const scenario = await activeScenario(ctx, now);
  const prefs = await preferencesFor(ctx, req.user.userId);
  const trip = tripId && ctx.trips ? await ctx.trips.get(req.user.userId, tripId) : null;
  const history = trip ? (await need(ctx.alerts, "alerts").listForTrip(req.user.userId, trip.tripId)).map(historyEntry) : [];
  const pe = evaluatePosition({ city, scenario, location, prefs, trip, history, dataAsOf: now, now });
  return ok({
    match: pe.match,
    reading: pe.reading,
    upcoming: pe.upcoming,
    wouldAlert: "raise" in pe.decision ? { kind: pe.decision.raise.kind, zoneId: pe.decision.raise.reading.zoneId, aqi: pe.decision.raise.reading.aqi } : null,
    suppression: suppressionOf(pe.decision),
    scenario: withLabel(scenario),
    dataAsOf: now.toISOString(),
  });
}

export const alertRoutes: Route[] = [
  { method: "GET", path: "/v1/alerts", auth: true, handler: listAlerts },
  { method: "POST", path: "/v1/alerts/evaluate", auth: true, handler: evaluate },
  { method: "POST", path: "/v1/alerts/{alertId}/actions", auth: true, idempotent: true, handler: alertAction },
];
