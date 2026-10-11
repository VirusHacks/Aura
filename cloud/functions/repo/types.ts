/**
 * Persistence ports. Each table has its own repository so each Lambda gets IAM
 * access only to the tables it uses. `memory.ts` implements the same ports for
 * tests and the local dev server; `dynamo.ts` for AWS.
 */
import type { AlertPreferences, DeviceTokenStatus, PollutionAlert, Scenario } from "../../../types/api";
import type { ZoneDataset } from "../../../types/air-quality";
import type { TripRecord } from "../domain/trips";

export interface ZoneTransition {
  at: string;
  fromZoneId: string | null;
  toZoneId: string;
  aqi: number;
}

export interface TripsRepo {
  get(userId: string, tripId: string): Promise<TripRecord | null>;
  /** The newest trip that has not ended, if any. */
  getActive(userId: string): Promise<TripRecord | null>;
  /** Fails with ConditionalCheckFailedException if the trip id exists. */
  create(trip: TripRecord): Promise<void>;
  /** Writes `trip` (version + 1) only if the stored version is still `trip.version`; returns the saved record. */
  save(trip: TripRecord): Promise<TripRecord>;
  addTransition(userId: string, tripId: string, t: ZoneTransition, retentionDays: number): Promise<void>;
  listTransitions(userId: string, tripId: string): Promise<ZoneTransition[]>;
}

export type DeliveryOutcome = "pending" | "sent" | "failed" | "endpoint-disabled" | "push-not-configured" | "skipped-preferences";

export interface AlertsRepo {
  get(userId: string, alertId: string): Promise<PollutionAlert | null>;
  listRecent(userId: string, limit: number): Promise<PollutionAlert[]>;
  listForTrip(userId: string, tripId: string): Promise<PollutionAlert[]>;
  /** Stores a new alert; false if that id already exists (duplicate request). */
  createIfAbsent(alert: PollutionAlert, retentionDays: number): Promise<boolean>;
  /**
   * Reserves "one alert per trip, zone and category". False when another
   * request already raised it (concurrent duplicate).
   */
  claimDedupe(userId: string, key: string, alertId: string, ttlSeconds: number): Promise<boolean>;
  save(alert: PollutionAlert): Promise<void>;
  /** Records one delivery attempt; false if this alert/device pair was already handled (duplicate event). */
  recordDelivery(userId: string, alertId: string, deviceId: string, outcome: DeliveryOutcome, detail: string | null): Promise<boolean>;
  /** Sets the final outcome of a delivery claimed with `recordDelivery(…, "pending")`. */
  updateDelivery(userId: string, alertId: string, deviceId: string, outcome: DeliveryOutcome, detail: string | null): Promise<void>;
}

export interface DeviceRecord {
  userId: string;
  deviceId: string;
  platform: "watchOS" | "iOS";
  environment: "sandbox" | "production";
  bundleId: string | null;
  /** Stored for endpoint updates; never returned by the API or logged. */
  token: string;
  endpointArn: string | null;
  tokenStatus: DeviceTokenStatus;
  updatedAt: string;
}

export interface UsersRepo {
  getPreferences(userId: string): Promise<AlertPreferences | null>;
  /** Last writer (by `updatedAt`) wins; returns the stored preferences. */
  putPreferences(userId: string, prefs: AlertPreferences): Promise<AlertPreferences>;
  listDevices(userId: string): Promise<DeviceRecord[]>;
  putDevice(device: DeviceRecord): Promise<void>;
  /** Fixed-window counter; true while the caller is under `limit` for this window. */
  allow(userId: string, bucket: string, limit: number, windowSeconds: number, now: Date): Promise<boolean>;
}

export interface StoredResponse {
  status: number;
  body: unknown;
}

export interface IdempotencyRepo {
  get(scope: string, key: string): Promise<StoredResponse | null>;
  put(scope: string, key: string, response: StoredResponse, ttlSeconds: number): Promise<void>;
}

export interface PairingRecord {
  pairingId: string;
  code: string;
  secretHash: string;
  status: "pending" | "approved" | "consumed";
  expiresAt: number;
  createdAt: string;
  username?: string;
  userId?: string;
  email?: string;
  approvedAt?: string;
}

export interface PairingRepo {
  /** Stores a new pairing; false if the code is already in use. */
  create(record: PairingRecord): Promise<boolean>;
  get(pairingId: string): Promise<PairingRecord | null>;
  getByCode(code: string): Promise<PairingRecord | null>;
  /** pending → approved, only if unexpired; false otherwise. */
  approve(pairingId: string, user: { userId: string; username: string; email?: string }, nowEpoch: number): Promise<boolean>;
  /** approved → consumed (one sign-in per pairing); false otherwise. */
  consume(pairingId: string, nowEpoch: number): Promise<boolean>;
}

export interface CityRepo {
  /** Zone baselines from the data table, or null to use the bundled demo dataset. */
  loadDataset(): Promise<ZoneDataset | null>;
  /** The scenario most recently saved from the 3D dashboard, with its time. */
  latestScenario(): Promise<{ scenario: Scenario; savedAt: string } | null>;
}
