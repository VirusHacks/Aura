/**
 * Trip state and its state machine. The trip item is the canonical record of
 * a journey; clients render it, the server owns it.
 *
 * Location privacy: the trip keeps the current zone and a coarse point on the
 * schematic city (0.1 world units ≈ 30 m), never raw GPS coordinates. Zone
 * transitions are separate items that expire after the retention period.
 */
import type {
  Evaluation,
  EvaluationSource,
  PollutionAlert,
  SelectedRoute,
  TravelMode,
  TripPhase,
  TripSource,
  TripStatusResponse,
  TripSummaryStats,
  WorldPoint,
} from "../../../types/api";
import { conflict } from "../shared/errors";

export interface ExposureState {
  aqiSeconds: number;
  knownSeconds: number;
  secondsAtOrAbovePoor: number;
  peakAqi: number | null;
  peakZoneName: string | null;
  lastAqi: number | null;
  lastSampleAt: string | null;
}

export interface TripRecord {
  userId: string;
  tripId: string;
  phase: TripPhase;
  source: TripSource;
  mode: TravelMode;
  startedAt: string;
  endedAt: string | null;
  originZoneId: string | null;
  destinationZoneId: string | null;
  plannedZoneIds: string[];
  currentZoneId: string | null;
  currentWorld: WorldPoint | null;
  currentSimulated: boolean;
  lastLocationAt: string | null;
  lastEvaluation: Evaluation | null;
  lastEvaluationSource: EvaluationSource | null;
  lastEvaluationAt: string | null;
  selectedRoute: SelectedRoute | null;
  zonesVisited: string[];
  alertCount: number;
  rerouteCount: number;
  exposure: ExposureState;
  isDemo: boolean;
  createdAt: string;
  updatedAt: string;
  /** Optimistic-concurrency counter; every save requires the version it read. */
  version: number;
}

export const POOR_AQI = 201;
/** Gaps longer than this (e.g. the app was closed) don't count as exposure. */
const MAX_SAMPLE_GAP_SECONDS = 600;

export function newTrip(input: {
  userId: string;
  tripId: string;
  source: TripSource;
  mode: TravelMode;
  startedAt: string;
  originZoneId: string | null;
  destinationZoneId: string | null;
  plannedZoneIds: string[];
  isDemo: boolean;
  now: Date;
}): TripRecord {
  const now = input.now.toISOString();
  return {
    userId: input.userId,
    tripId: input.tripId,
    phase: "active",
    source: input.source,
    mode: input.mode,
    startedAt: input.startedAt,
    endedAt: null,
    originZoneId: input.originZoneId,
    destinationZoneId: input.destinationZoneId,
    plannedZoneIds: input.plannedZoneIds,
    currentZoneId: null,
    currentWorld: null,
    currentSimulated: false,
    lastLocationAt: null,
    lastEvaluation: null,
    lastEvaluationSource: null,
    lastEvaluationAt: null,
    selectedRoute: null,
    zonesVisited: [],
    alertCount: 0,
    rerouteCount: 0,
    exposure: { aqiSeconds: 0, knownSeconds: 0, secondsAtOrAbovePoor: 0, peakAqi: null, peakZoneName: null, lastAqi: null, lastSampleAt: null },
    isDemo: input.isDemo,
    createdAt: now,
    updatedAt: now,
    version: 0,
  };
}

export type TripCommand = "pause" | "resume" | "end";

/** Applies a lifecycle command or throws 409 for an invalid transition. */
export function transition(trip: TripRecord, command: TripCommand, at: string): TripRecord {
  const next = { ...trip };
  switch (command) {
    case "pause":
      if (trip.phase !== "active") conflict("Trip is not active");
      next.phase = "paused";
      // Time spent paused is not exposure.
      next.exposure = { ...trip.exposure, lastSampleAt: null };
      break;
    case "resume":
      if (trip.phase !== "paused") conflict("Trip is not paused");
      next.phase = "active";
      break;
    case "end":
      if (trip.phase === "ended") conflict("Trip already ended");
      next.phase = "ended";
      next.endedAt = at;
      break;
  }
  return next;
}

export interface Sample {
  at: string;
  zoneId: string;
  zoneName: string;
  aqi: number;
  world: WorldPoint | null;
  simulated: boolean;
}

/** Folds one evaluated position into the trip; returns whether the zone changed. */
export function recordSample(trip: TripRecord, sample: Sample, keepPosition: boolean): { trip: TripRecord; zoneChanged: boolean; previousZoneId: string | null } {
  const e = { ...trip.exposure };
  if (e.lastSampleAt && e.lastAqi !== null) {
    const dt = (Date.parse(sample.at) - Date.parse(e.lastSampleAt)) / 1000;
    if (dt > 0 && dt <= MAX_SAMPLE_GAP_SECONDS) {
      e.aqiSeconds += e.lastAqi * dt;
      e.knownSeconds += dt;
      if (e.lastAqi >= POOR_AQI) e.secondsAtOrAbovePoor += dt;
    }
  }
  if (!e.lastSampleAt || Date.parse(sample.at) >= Date.parse(e.lastSampleAt)) {
    e.lastSampleAt = sample.at;
    e.lastAqi = sample.aqi;
  }
  if (e.peakAqi === null || sample.aqi > e.peakAqi) {
    e.peakAqi = sample.aqi;
    e.peakZoneName = sample.zoneName;
  }
  const previousZoneId = trip.currentZoneId;
  const zoneChanged = previousZoneId !== sample.zoneId;
  return {
    trip: {
      ...trip,
      exposure: e,
      currentZoneId: sample.zoneId,
      currentWorld: keepPosition && sample.world ? { x: Math.round(sample.world.x * 10) / 10, z: Math.round(sample.world.z * 10) / 10 } : null,
      currentSimulated: sample.simulated,
      lastLocationAt: sample.at,
      zonesVisited: trip.zonesVisited.includes(sample.zoneId) ? trip.zonesVisited : [...trip.zonesVisited, sample.zoneId].slice(-64),
    },
    zoneChanged,
    previousZoneId,
  };
}

export function summaryOf(trip: TripRecord, now: Date): TripSummaryStats {
  const end = trip.endedAt ? Date.parse(trip.endedAt) : now.getTime();
  const e = trip.exposure;
  return {
    durationSeconds: Math.max(0, Math.round((end - Date.parse(trip.startedAt)) / 1000)),
    zonesVisited: trip.zonesVisited,
    averageAqi: e.knownSeconds > 0 ? Math.round(e.aqiSeconds / e.knownSeconds) : e.lastAqi,
    peakAqi: e.peakAqi,
    peakZoneName: e.peakZoneName,
    secondsAtOrAbovePoor: Math.round(e.secondsAtOrAbovePoor),
    alertCount: trip.alertCount,
    rerouteCount: trip.rerouteCount,
  };
}

export function toStatus(trip: TripRecord, alerts: PollutionAlert[], now: Date): TripStatusResponse {
  return {
    tripId: trip.tripId,
    userId: trip.userId,
    phase: trip.phase,
    status: trip.phase,
    source: trip.source,
    mode: trip.mode,
    startedAt: trip.startedAt,
    endedAt: trip.endedAt,
    originZoneId: trip.originZoneId,
    destinationZoneId: trip.destinationZoneId,
    plannedZoneIds: trip.plannedZoneIds,
    currentZoneId: trip.currentZoneId,
    currentLocation: trip.lastLocationAt
      ? { world: trip.currentWorld, zoneId: trip.currentZoneId, simulated: trip.currentSimulated, at: trip.lastLocationAt }
      : null,
    selectedRouteId: trip.selectedRoute?.routeId ?? null,
    selectedRoute: trip.selectedRoute,
    lastEvaluation: trip.lastEvaluation,
    lastEvaluationSource: trip.lastEvaluationSource,
    lastEvaluationAt: trip.lastEvaluationAt,
    alerts: [...alerts].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    summary: summaryOf(trip, now),
    isDemo: trip.isDemo,
    updatedAt: trip.updatedAt,
  };
}
