/**
 * In-memory repositories with the same semantics as the DynamoDB ones
 * (conditional writes included). Used by unit tests and the local dev server.
 */
import type { AlertPreferences, PollutionAlert, Scenario } from "../../../types/api";
import type { ZoneDataset } from "../../../types/air-quality";
import type { TripRecord } from "../domain/trips";
import type {
  AlertsRepo,
  CityRepo,
  DeliveryOutcome,
  DeviceRecord,
  IdempotencyRepo,
  PairingRecord,
  PairingRepo,
  StoredResponse,
  TripsRepo,
  UsersRepo,
  ZoneTransition,
} from "./types";

const clone = <T>(v: T): T => structuredClone(v);

class ConditionalCheckFailed extends Error {
  override name = "ConditionalCheckFailedException";
}

export class MemoryTripsRepo implements TripsRepo {
  readonly trips = new Map<string, TripRecord>();
  readonly transitions = new Map<string, ZoneTransition[]>();
  private key = (u: string, t: string) => `${u}|${t}`;

  async get(userId: string, tripId: string) {
    const t = this.trips.get(this.key(userId, tripId));
    return t ? clone(t) : null;
  }
  async getActive(userId: string) {
    const open = [...this.trips.values()].filter((t) => t.userId === userId && t.phase !== "ended");
    open.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    return open[0] ? clone(open[0]) : null;
  }
  async create(trip: TripRecord) {
    const k = this.key(trip.userId, trip.tripId);
    if (this.trips.has(k)) throw new ConditionalCheckFailed("exists");
    this.trips.set(k, clone(trip));
  }
  async save(trip: TripRecord) {
    const k = this.key(trip.userId, trip.tripId);
    const stored = this.trips.get(k);
    if (!stored || stored.version !== trip.version) throw new ConditionalCheckFailed("version");
    const next = { ...trip, version: trip.version + 1 };
    this.trips.set(k, clone(next));
    return clone(next);
  }
  async addTransition(userId: string, tripId: string, t: ZoneTransition) {
    const k = this.key(userId, tripId);
    this.transitions.set(k, [...(this.transitions.get(k) ?? []), clone(t)]);
  }
  async listTransitions(userId: string, tripId: string) {
    return clone(this.transitions.get(this.key(userId, tripId)) ?? []);
  }
}

export class MemoryAlertsRepo implements AlertsRepo {
  readonly alerts = new Map<string, PollutionAlert>();
  readonly dedupe = new Set<string>();
  readonly deliveries = new Map<string, { outcome: DeliveryOutcome; detail: string | null }>();
  private key = (u: string, a: string) => `${u}|${a}`;

  async get(userId: string, alertId: string) {
    const a = this.alerts.get(this.key(userId, alertId));
    return a ? clone(a) : null;
  }
  async listRecent(userId: string, limit: number) {
    return [...this.alerts.values()]
      .filter((a) => a.userId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
      .map(clone);
  }
  async listForTrip(userId: string, tripId: string) {
    return [...this.alerts.values()].filter((a) => a.userId === userId && a.tripId === tripId).map(clone);
  }
  async createIfAbsent(alert: PollutionAlert) {
    const k = this.key(alert.userId!, alert.id);
    if (this.alerts.has(k)) return false;
    this.alerts.set(k, clone(alert));
    return true;
  }
  async claimDedupe(userId: string, key: string) {
    const k = `${userId}|${key}`;
    if (this.dedupe.has(k)) return false;
    this.dedupe.add(k);
    return true;
  }
  async save(alert: PollutionAlert) {
    this.alerts.set(this.key(alert.userId!, alert.id), clone(alert));
  }
  async recordDelivery(userId: string, alertId: string, deviceId: string, outcome: DeliveryOutcome, detail: string | null) {
    const k = `${userId}|${alertId}|${deviceId}`;
    if (this.deliveries.has(k)) return false;
    this.deliveries.set(k, { outcome, detail });
    return true;
  }
  async updateDelivery(userId: string, alertId: string, deviceId: string, outcome: DeliveryOutcome, detail: string | null) {
    this.deliveries.set(`${userId}|${alertId}|${deviceId}`, { outcome, detail });
  }
}

export class MemoryUsersRepo implements UsersRepo {
  readonly prefs = new Map<string, AlertPreferences>();
  readonly devices = new Map<string, DeviceRecord>();
  private readonly counters = new Map<string, number>();

  async getPreferences(userId: string) {
    const p = this.prefs.get(userId);
    return p ? clone(p) : null;
  }
  async putPreferences(userId: string, prefs: AlertPreferences) {
    const current = this.prefs.get(userId);
    if (current && Date.parse(current.updatedAt) > Date.parse(prefs.updatedAt)) return clone(current);
    this.prefs.set(userId, clone(prefs));
    return clone(prefs);
  }
  async listDevices(userId: string) {
    return [...this.devices.values()].filter((d) => d.userId === userId).map(clone);
  }
  async putDevice(device: DeviceRecord) {
    this.devices.set(`${device.userId}|${device.deviceId}`, clone(device));
  }
  async allow(userId: string, bucket: string, limit: number, windowSeconds: number, now: Date) {
    const window = Math.floor(now.getTime() / 1000 / windowSeconds);
    const k = `${userId}|${bucket}|${window}`;
    const n = (this.counters.get(k) ?? 0) + 1;
    this.counters.set(k, n);
    return n <= limit;
  }
}

export class MemoryIdempotencyRepo implements IdempotencyRepo {
  readonly items = new Map<string, StoredResponse>();
  async get(scope: string, key: string) {
    const v = this.items.get(`${scope}|${key}`);
    return v ? clone(v) : null;
  }
  async put(scope: string, key: string, response: StoredResponse) {
    this.items.set(`${scope}|${key}`, clone(response));
  }
}

export class MemoryPairingRepo implements PairingRepo {
  readonly byId = new Map<string, PairingRecord>();
  readonly byCode = new Map<string, string>();

  async create(record: PairingRecord) {
    const existing = this.byCode.get(record.code);
    if (existing && (this.byId.get(existing)?.expiresAt ?? 0) > Date.parse(record.createdAt) / 1000) return false;
    this.byId.set(record.pairingId, clone(record));
    this.byCode.set(record.code, record.pairingId);
    return true;
  }
  async get(pairingId: string) {
    const r = this.byId.get(pairingId);
    return r ? clone(r) : null;
  }
  async getByCode(code: string) {
    const id = this.byCode.get(code);
    return id ? this.get(id) : null;
  }
  async approve(pairingId: string, user: { userId: string; username: string; email?: string }, nowEpoch: number) {
    const r = this.byId.get(pairingId);
    if (!r || r.status !== "pending" || r.expiresAt <= nowEpoch) return false;
    this.byId.set(pairingId, { ...r, status: "approved", userId: user.userId, username: user.username, email: user.email, approvedAt: new Date(nowEpoch * 1000).toISOString() });
    return true;
  }
  async consume(pairingId: string, nowEpoch: number) {
    const r = this.byId.get(pairingId);
    if (!r || r.status !== "approved" || r.expiresAt <= nowEpoch) return false;
    this.byId.set(pairingId, { ...r, status: "consumed" });
    return true;
  }
}

export class MemoryCityRepo implements CityRepo {
  constructor(
    public dataset: ZoneDataset | null = null,
    public scenario: { scenario: Scenario; savedAt: string } | null = null,
  ) {}
  async loadDataset() {
    return this.dataset;
  }
  async latestScenario() {
    return this.scenario;
  }
}
