/**
 * Per-user settings: alert preferences and consent, push device registration,
 * and approving a watch pairing code.
 */
import type { AlertPreferences, DeviceRegistration, PairingClaimResponse } from "../../../types/api";
import { DEFAULT_PREFERENCES, categoryRank } from "../domain/alerts";
import { normalizeCode } from "../domain/pairing";
import type { DeviceRecord } from "../repo/types";
import { badRequest, notFound, rateLimited } from "../shared/errors";
import { metric } from "../shared/log";
import * as v from "../shared/validation";
import { type AppContext, need } from "./context";
import { type ApiRequest, type AuthUser, type Route, ok } from "./http";
import { preferencesFor } from "./trips";

async function getPreferences(req: ApiRequest & { user: AuthUser }, ctx: AppContext) {
  return ok(await preferencesFor(ctx, req.user.userId));
}

async function putPreferences(req: ApiRequest & { user: AuthUser }, ctx: AppContext) {
  const body = v.object(req.body);
  if (categoryRank(String(body.threshold)) < 0) badRequest(`threshold must be one of ${v.CATEGORIES.join(", ")}`);
  const current = await preferencesFor(ctx, req.user.userId);
  const prefs: AlertPreferences = {
    alertsEnabled: v.bool(body.alertsEnabled, current.alertsEnabled),
    threshold: body.threshold as AlertPreferences["threshold"],
    // 0 = no cooldown: every new zone at or above the threshold alerts (still once per zone and category).
    cooldownMinutes: v.intInRange(body.cooldownMinutes, 0, 240, DEFAULT_PREFERENCES.cooldownMinutes),
    onlyDuringTrips: v.bool(body.onlyDuringTrips, current.onlyDuringTrips),
    sensitiveGroup: v.bool(body.sensitiveGroup, current.sensitiveGroup),
    lookAhead: v.bool(body.lookAhead, current.lookAhead),
    travelMode: v.optionalOneOf(body.travelMode, v.TRAVEL_MODES, current.travelMode),
    staleAfterMinutes: v.intInRange(body.staleAfterMinutes, 5, 240, DEFAULT_PREFERENCES.staleAfterMinutes),
    locationConsent: v.bool(body.locationConsent, current.locationConsent ?? true),
    updatedAt: body.updatedAt === undefined ? ctx.clock().toISOString() : v.isoDate(body.updatedAt, "updatedAt"),
  };
  // Last writer (by updatedAt) wins across watch, iPhone and dashboard.
  return ok(await need(ctx.users, "users").putPreferences(req.user.userId, prefs));
}

async function registerDevice(req: ApiRequest & { user: AuthUser }, ctx: AppContext) {
  const body = v.object(req.body);
  const deviceId = v.id(req.params.deviceId, "deviceId");
  if (typeof body.token !== "string" || !/^[0-9a-f]{16,200}$/i.test(body.token)) badRequest("token must be the hex APNs device token");
  const platform = v.oneOf(body.platform, ["watchOS", "iOS"] as const, "platform");
  const environment = v.optionalOneOf(body.environment, ["sandbox", "production"] as const, "sandbox");
  const users = need(ctx.users, "users");
  const existing = (await users.listDevices(req.user.userId)).find((d) => d.deviceId === deviceId);
  const token = (body.token as string).toLowerCase();
  const platformArn = environment === "production" ? ctx.config.push.productionArn : ctx.config.push.sandboxArn;

  let endpointArn: string | null = null;
  let tokenStatus: DeviceRecord["tokenStatus"] = "push-not-configured";
  if (platformArn && ctx.push) {
    try {
      const reuse = existing?.endpointArn && existing.token === token ? existing.endpointArn : (existing?.endpointArn ?? null);
      endpointArn = await ctx.push.ensureEndpoint(platformArn, token, reuse);
      tokenStatus = "active";
      metric("DeviceRegistrations", 1, { Outcome: "endpoint" });
    } catch (err) {
      ctx.log.warn("SNS endpoint registration failed", { error: (err as Error).name });
      tokenStatus = "invalid";
      metric("DeviceRegistrations", 1, { Outcome: "failed" });
    }
  } else {
    metric("DeviceRegistrations", 1, { Outcome: "push-not-configured" });
  }
  const now = ctx.clock().toISOString();
  await users.putDevice({
    userId: req.user.userId,
    deviceId,
    platform,
    environment,
    bundleId: typeof body.bundleId === "string" ? body.bundleId.slice(0, 200) : null,
    token,
    endpointArn,
    tokenStatus,
    updatedAt: now,
  });
  const response: DeviceRegistration & { registered: true; push: boolean } = {
    registered: true,
    push: tokenStatus === "active",
    userId: req.user.userId,
    deviceId,
    platform,
    endpointId: endpointArn ? endpointArn.split("/").pop()! : null,
    tokenStatus,
    updatedAt: now,
  };
  return ok(response);
}

async function claimPairing(req: ApiRequest & { user: AuthUser }, ctx: AppContext) {
  const body = v.object(req.body);
  const code = normalizeCode(body.code) ?? badRequest("Enter the 6-character code shown on the watch");
  const now = ctx.clock();
  // Guessing codes is pointless at this rate, and each code lives 10 minutes.
  if (!(await need(ctx.users, "users").allow(req.user.userId, "pair-claim", 10, 600, now))) rateLimited();
  const pairing = need(ctx.pairing, "pairing");
  const record = await pairing.getByCode(code);
  const nowEpoch = Math.floor(now.getTime() / 1000);
  if (!record || record.expiresAt <= nowEpoch || record.status !== "pending") {
    metric("PairingClaims", 1, { Outcome: "not-found" });
    notFound("Code not found or expired. Ask the watch for a new code.");
  }
  if (!(await pairing.approve(record!.pairingId, { userId: req.user.userId, username: req.user.username, email: req.user.email }, nowEpoch))) {
    notFound("Code not found or expired. Ask the watch for a new code.");
  }
  metric("PairingClaims", 1, { Outcome: "approved" });
  return ok({ paired: true, expiresAt: new Date(record!.expiresAt * 1000).toISOString() } satisfies PairingClaimResponse);
}

export const settingsRoutes: Route[] = [
  { method: "GET", path: "/v1/preferences", auth: true, handler: getPreferences },
  { method: "PUT", path: "/v1/preferences", auth: true, idempotent: true, handler: putPreferences },
  { method: "PUT", path: "/v1/devices/{deviceId}", auth: true, handler: registerDevice },
  { method: "POST", path: "/v1/pairing/claim", auth: true, handler: claimPairing },
];
