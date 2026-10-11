/**
 * Alert eligibility. The same rules as watch/AeroscopeKit AlertEvaluator.swift:
 *
 * - alerts off, or no active trip while "only during trips" → suppress
 * - data older than `staleAfterMinutes` → suppress (never alert on stale data)
 * - below the (sensitive-adjusted) threshold → suppress
 * - already warned for this zone at this category or worse → suppress
 * - within the cooldown after the last alert → suppress, unless the air is worse (escalation)
 * - otherwise raise for the current zone, or for the next planned zone (look-ahead)
 */
import { AQI_BANDS, getAqiCategory } from "../../../lib/aqi";
import type {
  AlertKind,
  AlertPreferences,
  EvaluationSource,
  PollutionAlert,
  SuppressionReason,
  TripPhase,
  ZoneReadingV1,
} from "../../../types/api";
import type { AqiCategory } from "../../../types/air-quality";

export const CATEGORY_ORDER: readonly AqiCategory[] = AQI_BANDS.map((b) => b.category);
export const categoryRank = (c: AqiCategory | string): number => CATEGORY_ORDER.indexOf(c as AqiCategory);

export const DEFAULT_PREFERENCES: AlertPreferences = {
  alertsEnabled: true,
  threshold: "Poor",
  cooldownMinutes: 15,
  onlyDuringTrips: true,
  sensitiveGroup: false,
  lookAhead: true,
  travelMode: "walk",
  staleAfterMinutes: 30,
  locationConsent: true,
  updatedAt: new Date(0).toISOString(),
};

/** Lowest AQI that alerts; sensitive groups are warned one category earlier. */
export function effectiveThresholdAqi(prefs: AlertPreferences): number {
  let rank = Math.max(0, categoryRank(prefs.threshold));
  if (prefs.sensitiveGroup && rank > 1) rank -= 1;
  return AQI_BANDS[rank].min;
}

export interface AlertHistoryEntry {
  zoneId: string;
  category: AqiCategory;
  kind: AlertKind;
  createdAt: string;
}

export const historyEntry = (a: Pick<PollutionAlert, "zoneId" | "aqi" | "kind" | "createdAt">): AlertHistoryEntry => ({
  zoneId: a.zoneId,
  category: getAqiCategory(a.aqi),
  kind: a.kind,
  createdAt: a.createdAt,
});

export type AlertDecision = { raise: { kind: AlertKind; reading: ZoneReadingV1 } } | { suppress: SuppressionReason };

export interface AlertContext {
  reading: ZoneReadingV1;
  dataAsOf: Date;
  upcoming: ZoneReadingV1 | null;
  tripPhase: TripPhase | null;
  history: AlertHistoryEntry[];
  now: Date;
}

export function evaluateAlert(ctx: AlertContext, prefs: AlertPreferences): AlertDecision {
  const { reading, dataAsOf, upcoming, tripPhase, history, now } = ctx;
  if (!prefs.alertsEnabled) return { suppress: "disabled" };
  if (prefs.onlyDuringTrips && tripPhase !== "active") return { suppress: "no-active-trip" };
  if (now.getTime() - dataAsOf.getTime() > prefs.staleAfterMinutes * 60_000) return { suppress: "stale-data" };
  const threshold = effectiveThresholdAqi(prefs);

  const check = (r: ZoneReadingV1, kind: AlertKind): AlertDecision => {
    const rank = categoryRank(getAqiCategory(r.aqi));
    if (history.some((h) => h.zoneId === r.zoneId && categoryRank(h.category) >= rank)) return { suppress: "already-warned" };
    const latest = history.reduce<AlertHistoryEntry | null>((a, h) => (!a || Date.parse(h.createdAt) > Date.parse(a.createdAt) ? h : a), null);
    const escalation = latest ? rank > categoryRank(latest.category) : false;
    if (!escalation && latest && now.getTime() - Date.parse(latest.createdAt) < prefs.cooldownMinutes * 60_000) {
      return { suppress: "cooling-down" };
    }
    return { raise: { kind: kind === "entered-zone" && escalation ? "escalation" : kind, reading: r } };
  };

  let reason: SuppressionReason = "below-threshold";
  if (reading.aqi >= threshold) {
    const d = check(reading, "entered-zone");
    if ("raise" in d) return d;
    reason = d.suppress;
  }
  if (prefs.lookAhead && upcoming && upcoming.zoneId !== reading.zoneId && upcoming.aqi >= threshold) {
    const d = check(upcoming, "upcoming-zone");
    if ("raise" in d) return d;
    if (reason === "below-threshold") reason = d.suppress;
  }
  return { suppress: reason };
}

export function alertReason(kind: AlertKind, reading: ZoneReadingV1, prefs: AlertPreferences): string {
  const category = getAqiCategory(reading.aqi);
  const threshold = `${prefs.threshold}${prefs.sensitiveGroup ? " (sensitive: one category earlier)" : ""}`;
  switch (kind) {
    case "upcoming-zone":
      return `Next zone on your route, ${reading.zoneName}, is ${category} (AQI ${reading.aqi}); your alert threshold is ${threshold}.`;
    case "escalation":
      return `Air got worse: ${reading.zoneName} is ${category} (AQI ${reading.aqi}), above your last alert.`;
    default:
      return `You entered ${reading.zoneName}: ${category} (AQI ${reading.aqi}); your alert threshold is ${threshold}.`;
  }
}

export interface NewAlertInput {
  id: string;
  userId: string;
  tripId: string | null;
  kind: AlertKind;
  reading: ZoneReadingV1;
  prefs: AlertPreferences;
  scenarioLabel: string;
  dataAsOf: string;
  now: Date;
  source: EvaluationSource;
}

export function buildAlert(input: NewAlertInput): PollutionAlert {
  const { reading } = input;
  const createdAt = input.now.toISOString();
  return {
    id: input.id,
    alertId: input.id,
    tripId: input.tripId,
    userId: input.userId,
    zoneId: reading.zoneId,
    zoneName: reading.zoneName,
    aqi: reading.aqi,
    category: getAqiCategory(reading.aqi),
    pm25: reading.pm25,
    kind: input.kind,
    origin: "backend",
    status: "active",
    reason: alertReason(input.kind, reading, input.prefs),
    // Scenario-model readings are illustrative; a verified live feed would be LIVE.
    source: reading.simulated ? "DEMO" : "LIVE",
    observedAt: input.dataAsOf,
    createdAt,
    updatedAt: createdAt,
    acknowledgedAt: null,
    scenarioLabel: input.scenarioLabel,
    simulated: reading.simulated,
    isDemo: reading.simulated || input.source !== "device",
  };
}
