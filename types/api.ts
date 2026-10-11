/**
 * AEROSCOPE API contract, version 1.
 *
 * Shared by the Lambda functions (cloud/functions), the Next.js dashboard and
 * mirrored by the Swift `Codable` models in watch/AeroscopeKit/Networking.
 * Fields may be added within v1; existing fields and enum values never change
 * meaning (the Swift enums reject unknown values). See cloud/docs/API.md.
 */
import type { AqiCategory, DataProvenance, DominantPollutant, ScenarioPresetId } from "./air-quality";

export const API_VERSION = "v1";
export const EVENT_SCHEMA_VERSION = 1;

// ---------------------------------------------------------------- Primitives

/** LIVE = verified measurement; CACHED = earlier measurement with its original time; DEMO = illustrative. */
export type DataStatus = "LIVE" | "CACHED" | "DEMO";
export type TravelMode = "walk" | "cycle" | "motor";
export type TripPhase = "active" | "paused" | "ended";
/** How the trip is driven: `live` (backend) or `demo` (the watch's offline simulation). */
export type TripSource = "live" | "demo";
/** Who reported a position: the watch/phone GPS, the web dashboard (simulated walk) or a demo operator. */
export type EvaluationSource = "device" | "dashboard" | "operator";
export type AlertKind = "entered-zone" | "escalation" | "upcoming-zone";
export type AlertOrigin = "backend" | "device" | "demo";
export type AlertStatus = "active" | "acknowledged" | "dismissed" | "reroute-requested" | "rerouted";
export type SuppressionReason =
  | "disabled"
  | "no-active-trip"
  | "stale-data"
  | "below-threshold"
  | "already-warned"
  | "cooling-down";
export type RouteKind = "fastest" | "cleaner" | "planned";
export type RouteChoice = "alternative" | "current";
export type RoutingProviderId = "amazon-location" | "demo-zone-graph";

export interface GeoPoint {
  lat: number;
  lon: number;
}

/** Position on the 3D city's ground plane (world units). */
export interface WorldPoint {
  x: number;
  z: number;
}

export interface Scenario {
  preset: ScenarioPresetId;
  timeIndex: number;
}

export interface ScenarioWithLabel extends Scenario {
  label: string;
}

// ---------------------------------------------------------------- Air quality

/** Scenario reading for one zone (the shape the watch decodes as `ZoneReading`). */
export interface ZoneReadingV1 {
  zoneId: string;
  zoneName: string;
  region: string;
  aqi: number;
  category: AqiCategory;
  pm25: number;
  pm10: number;
  dominant: DominantPollutant;
  temperature: number;
  windSpeed: number;
  scenarioTime: string;
  provenance: DataProvenance;
  simulated: boolean;
}

/** `GET /v1/air-quality/zones` item. */
export interface AirQualityZone {
  zoneId: string;
  zoneName: string;
  region: string;
  aqi: number;
  aqiCategory: AqiCategory;
  pm25: number;
  pm10: number;
  latitude: number | null;
  longitude: number | null;
  world: WorldPoint;
  radius: number;
  windSpeed: number;
  windDirection: number;
  observedAt: string;
  source: DataStatus;
  provenance: DataProvenance;
  isDemo: boolean;
}

export interface AirQualityZonesResponse {
  zones: AirQualityZone[];
  scenario: ScenarioWithLabel;
  sourceLabel: string;
  generatedAt: string;
}

export interface ZoneMatch {
  zoneId: string;
  zoneName: string;
  distanceKm: number;
  world: WorldPoint | null;
}

export interface CurrentReadingResponse {
  reading: ZoneReadingV1;
  match: ZoneMatch;
  scenario: ScenarioWithLabel;
  generatedAt: string;
}

// ---------------------------------------------------------------- Locations & evaluation

export interface LocationPayload {
  geo?: GeoPoint | null;
  zoneId?: string | null;
  world?: WorldPoint | null;
  accuracyMeters?: number | null;
  simulated: boolean;
}

export interface PollutionAlert {
  /** Same value as `alertId`; the watch decodes `id`. */
  id: string;
  alertId: string;
  tripId: string | null;
  userId?: string;
  zoneId: string;
  zoneName: string;
  aqi: number;
  category: AqiCategory;
  pm25: number | null;
  kind: AlertKind;
  origin: AlertOrigin;
  status: AlertStatus;
  /** Why the alert fired, in words. */
  reason: string;
  /** DEMO for scenario-model readings; LIVE only for verified measurements. */
  source: DataStatus;
  observedAt: string;
  createdAt: string;
  updatedAt?: string;
  acknowledgedAt?: string | null;
  scenarioLabel: string | null;
  simulated: boolean;
  isDemo: boolean;
}

export interface Evaluation {
  reading: ZoneReadingV1;
  match: ZoneMatch;
  upcoming: ZoneReadingV1 | null;
  alert: PollutionAlert | null;
  suppression: SuppressionReason | null;
  scenario: ScenarioWithLabel;
  dataAsOf: string;
}

// ---------------------------------------------------------------- Routes

export interface ZoneExposureSummary {
  zoneId: string;
  zoneName: string;
  aqi: number;
  category: AqiCategory;
  seconds: number;
  meters: number;
}

/** One candidate route with its pollution score (spec `RouteAlternative`). */
export interface RouteAlternative {
  routeId: string;
  kind: RouteKind;
  provider: RoutingProviderId;
  estimatedDurationSeconds: number;
  distanceMeters: number;
  /** Duration-weighted mean AQI over the part of the route inside known zones. */
  routeAQIScore: number | null;
  timeInElevatedAQIZonesSeconds: number;
  /** Seconds of the route that could not be matched to a zone reading. */
  unknownSeconds: number;
  zoneSummaries: ZoneExposureSummary[];
  zoneIds: string[];
  /** [lon, lat] pairs (simplified). */
  geometry: [number, number][];
  /** The same path on the 3D city's ground plane. */
  world: WorldPoint[];
  isDemo: boolean;
}

/** Route summary decoded by the watch as `RouteOption`. */
export interface RouteOption {
  id: string;
  kind: RouteKind;
  zoneIds: string[];
  zoneNames: string[];
  distanceKm: number;
  durationMinutes: number;
  averageAqi: number;
  peakAqi: number;
  peakZoneName: string;
  exposureIndex: number;
}

export interface RouteComparison {
  id: string;
  fromZoneId: string;
  toZoneId: string;
  mode: TravelMode;
  current: RouteOption;
  alternative: RouteOption | null;
  exposureReductionPercent: number | null;
  extraMinutes: number | null;
  note: string;
  generatedAt: string;
  scenarioLabel: string | null;
  /** Every scored candidate, the current route first. */
  alternatives: RouteAlternative[];
  provider: RoutingProviderId;
  /** Explains how `routeAQIScore` is computed and what it is not. */
  methodology: string;
  isDemo: boolean;
}

export interface SelectedRoute {
  routeId: string;
  choice: RouteChoice;
  zoneIds: string[];
  world: WorldPoint[];
  geometry: [number, number][];
  provider: RoutingProviderId | null;
  selectedAt: string;
}

// ---------------------------------------------------------------- Trips

export interface TripSummaryStats {
  durationSeconds: number;
  zonesVisited: string[];
  averageAqi: number | null;
  peakAqi: number | null;
  peakZoneName: string | null;
  secondsAtOrAbovePoor: number;
  alertCount: number;
  rerouteCount: number;
}

/** `GET /v1/trips/{tripId}` and `GET /v1/trips/active` (spec `Trip` + the watch's trip status). */
export interface TripStatusResponse {
  tripId: string;
  userId: string;
  phase: TripPhase;
  status: TripPhase;
  source: TripSource;
  mode: TravelMode;
  startedAt: string;
  endedAt: string | null;
  originZoneId: string | null;
  destinationZoneId: string | null;
  plannedZoneIds: string[];
  currentZoneId: string | null;
  currentLocation: { world: WorldPoint | null; zoneId: string | null; simulated: boolean; at: string } | null;
  selectedRouteId: string | null;
  selectedRoute: SelectedRoute | null;
  lastEvaluation: Evaluation | null;
  lastEvaluationSource: EvaluationSource | null;
  lastEvaluationAt: string | null;
  alerts: PollutionAlert[];
  summary: TripSummaryStats;
  isDemo: boolean;
  updatedAt: string;
}

export interface StartTripRequest {
  tripId: string;
  startedAt: string;
  mode?: TravelMode;
  source?: TripSource;
  origin?: LocationPayload | null;
  destinationZoneId?: string | null;
  plannedZoneIds?: string[];
}

export type TripEventType = "location" | "pause" | "resume" | "end";

export interface TripEventRequest {
  type: TripEventType;
  at: string;
  location?: LocationPayload;
  /** An alert the watch raised offline; stored under the same id. */
  deviceAlert?: Partial<PollutionAlert> & { id: string; zoneId: string; aqi: number };
}

export interface AcceptRouteRequest {
  routeId: string;
  choice: RouteChoice;
  zoneIds: string[];
  alertId?: string | null;
  at: string;
}

export interface RouteCompareRequest {
  fromZoneId: string;
  toZoneId: string;
  mode?: TravelMode;
  plannedZoneIds?: string[];
  tripId?: string;
}

export type AlertAction = "acknowledge" | "dismiss" | "request-route";

export interface AlertActionRequest {
  action: AlertAction;
  at: string;
  mode?: TravelMode;
  currentZoneId?: string;
  destinationZoneId?: string;
  plannedZoneIds?: string[];
}

/** Union response of every mutation. */
export interface OperationResult {
  tripPhase?: TripPhase;
  plannedZoneIds?: string[];
  evaluation?: Evaluation | null;
  alert?: PollutionAlert | null;
  routeComparison?: RouteComparison | null;
  trip?: TripStatusResponse;
  replayed?: boolean;
}

// ---------------------------------------------------------------- Settings

export interface AlertPreferences {
  alertsEnabled: boolean;
  threshold: AqiCategory;
  cooldownMinutes: number;
  onlyDuringTrips: boolean;
  sensitiveGroup: boolean;
  lookAhead: boolean;
  travelMode: TravelMode;
  staleAfterMinutes: number;
  /** Consent to store trip positions (zone level) on the backend. */
  locationConsent?: boolean;
  updatedAt: string;
}

export interface DeviceRegistrationRequest {
  token: string;
  platform: "watchOS" | "iOS";
  environment: "sandbox" | "production";
  bundleId?: string;
}

export type DeviceTokenStatus = "active" | "invalid" | "push-not-configured";

/** Spec `DeviceRegistration` (the response; tokens are never returned). */
export interface DeviceRegistration {
  userId: string;
  deviceId: string;
  platform: "watchOS" | "iOS";
  endpointId: string | null;
  tokenStatus: DeviceTokenStatus;
  updatedAt: string;
}

// ---------------------------------------------------------------- Watch pairing

export interface PairingStartResponse {
  pairingId: string;
  /** Six characters the user types on the web dashboard. */
  code: string;
  /** Secret only the watch knows; proves the watch when it signs in. */
  secret: string;
  expiresAt: string;
}

export interface PairingStatusResponse {
  status: "pending" | "approved" | "consumed" | "expired";
  /** Cognito username to sign in with once approved. */
  username?: string;
  email?: string;
}

export interface PairingClaimResponse {
  paired: true;
  expiresAt: string;
}

// ---------------------------------------------------------------- Client configuration

export interface ClientConfig {
  apiVersion: string;
  stage: string;
  region: string;
  cognito: { userPoolId: string; webClientId: string; iosClientId: string; watchClientId: string };
  realtime: { httpDomain: string; realtimeDomain: string; namespace: string } | null;
  routing: RoutingProviderId;
  push: boolean;
  webUrl: string | null;
}

export interface HealthResponse {
  status: "ok";
  version: string;
  stage: string;
  provenance: DataProvenance;
  scenario: ScenarioWithLabel;
  push: boolean;
  realtime: boolean;
  routing: RoutingProviderId;
}

// ---------------------------------------------------------------- Real-time & domain events

export type RealtimeEventType =
  | "trip.started"
  | "trip.location.updated"
  | "trip.zone.changed"
  | "trip.paused"
  | "trip.resumed"
  | "trip.ended"
  | "airquality.updated"
  | "alert.created"
  | "alert.acknowledged"
  | "alert.updated"
  | "route.alternatives.generated"
  | "route.selected";

/** Versioned envelope for every real-time message (AppSync Events channel `/aeroscope/users/{sub}`). */
export interface EventEnvelope<P = Record<string, unknown>> {
  eventId: string;
  type: RealtimeEventType;
  schemaVersion: number;
  occurredAt: string;
  tripId?: string;
  zoneId?: string;
  correlationId: string;
  payload: P;
}

/** EventBridge detail-types on the `aeroscope-<stage>` bus (source `aeroscope.api`). */
export const DOMAIN_EVENTS = {
  TripStarted: "AeroScope.TripStarted",
  TripLocationUpdated: "AeroScope.TripLocationUpdated",
  TripZoneChanged: "AeroScope.TripZoneChanged",
  TripPaused: "AeroScope.TripPaused",
  TripResumed: "AeroScope.TripResumed",
  TripEnded: "AeroScope.TripEnded",
  AirQualityThresholdCrossed: "AeroScope.AirQualityThresholdCrossed",
  AlertCreated: "AeroScope.AlertCreated",
  AlertUpdated: "AeroScope.AlertUpdated",
  RouteAlternativesGenerated: "AeroScope.RouteAlternativesGenerated",
  RouteSelected: "AeroScope.RouteSelected",
} as const;

export type DomainEventType = (typeof DOMAIN_EVENTS)[keyof typeof DOMAIN_EVENTS];

/** EventBridge `detail`: the owner plus the envelope that becomes the real-time message. */
export interface DomainEventDetail<P = Record<string, unknown>> {
  userId: string;
  envelope: EventEnvelope<P>;
}

export interface ApiError {
  error: string;
  code?: "outside-coverage" | "unauthenticated" | "forbidden" | "validation" | "conflict" | "rate-limited" | "not-found";
  correlationId?: string;
}
