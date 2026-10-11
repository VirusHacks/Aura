/**
 * DynamoDB repositories. Table layouts (all on-demand, encrypted at rest):
 *
 * Trips        pk userId  sk TRIP#<tripId>              trip record (optimistic `version`)
 *                          sk ZONE#<tripId>#<at>          zone transition (TTL = location retention)
 * Alerts       pk userId  sk ALERT#<alertId>             alert (TTL); GSI byCreated (userId, createdAt)
 *                          sk DEDUPE#<trip>#<zone>#<rank> one alert per trip/zone/category (TTL)
 *                          sk DELIVERY#<alertId>#<device> push attempt (TTL)
 * Users        pk userId  sk PREFS | DEVICE#<id> | RATE#<bucket>#<window> (TTL)
 * Idempotency  pk id = <scope>#<key>                     stored response (TTL 7 days)
 * Pairing      pk id = PAIR#<pairingId> | CODE#<code>    watch pairing (TTL 10 minutes)
 */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  type QueryCommandInput,
  ScanCommand,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import type { AlertPreferences, PollutionAlert, Scenario } from "../../../types/api";
import { datasetFromItems, normalizeScenario } from "../domain/city";
import type { TripRecord } from "../domain/trips";
import { isConditionalFailure } from "../shared/errors";
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

let shared: DynamoDBDocumentClient | null = null;
export function documentClient(): DynamoDBDocumentClient {
  shared ??= DynamoDBDocumentClient.from(new DynamoDBClient({ maxAttempts: 3 }), {
    marshallOptions: { removeUndefinedValues: true, convertClassInstanceToMap: true },
  });
  return shared;
}

const epoch = (date: Date) => Math.floor(date.getTime() / 1000);
const days = (n: number) => n * 86_400;

async function queryAll(db: DynamoDBDocumentClient, input: QueryCommandInput, max = 1000): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  let start: Record<string, unknown> | undefined;
  do {
    const res = await db.send(new QueryCommand({ ...input, ExclusiveStartKey: start }));
    out.push(...((res.Items as Record<string, unknown>[]) ?? []));
    start = res.LastEvaluatedKey;
  } while (start && out.length < max);
  return out;
}

function stripKeys<T>(item: Record<string, unknown> | undefined, ...keys: string[]): T | null {
  if (!item) return null;
  const copy = { ...item };
  for (const k of keys) delete copy[k];
  return copy as T;
}

// ---------------------------------------------------------------- Trips

export class DynamoTripsRepo implements TripsRepo {
  constructor(private readonly table: string, private readonly db = documentClient()) {}

  async get(userId: string, tripId: string) {
    const res = await this.db.send(new GetCommand({ TableName: this.table, Key: { userId, sk: `TRIP#${tripId}` }, ConsistentRead: true }));
    return stripKeys<TripRecord>(res.Item, "sk", "kind", "expiresAt");
  }

  async getActive(userId: string) {
    const items = await queryAll(this.db, {
      TableName: this.table,
      KeyConditionExpression: "userId = :u AND begins_with(sk, :p)",
      FilterExpression: "phase <> :ended",
      ExpressionAttributeValues: { ":u": userId, ":p": "TRIP#", ":ended": "ended" },
      ConsistentRead: true,
    });
    const open = items.map((i) => stripKeys<TripRecord>(i, "sk", "kind", "expiresAt")!).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    return open[0] ?? null;
  }

  async create(trip: TripRecord) {
    await this.db.send(
      new PutCommand({
        TableName: this.table,
        Item: { ...trip, sk: `TRIP#${trip.tripId}`, kind: "trip" },
        ConditionExpression: "attribute_not_exists(sk)",
      }),
    );
  }

  async save(trip: TripRecord) {
    const next = { ...trip, version: trip.version + 1 };
    // Ended trips keep their summary for 90 days, then expire.
    const expiresAt = trip.phase === "ended" ? epoch(new Date()) + days(90) : undefined;
    await this.db.send(
      new PutCommand({
        TableName: this.table,
        Item: { ...next, sk: `TRIP#${trip.tripId}`, kind: "trip", expiresAt },
        ConditionExpression: "#v = :expected",
        ExpressionAttributeNames: { "#v": "version" },
        ExpressionAttributeValues: { ":expected": trip.version },
      }),
    );
    return next;
  }

  async addTransition(userId: string, tripId: string, t: ZoneTransition, retentionDays: number) {
    await this.db.send(
      new PutCommand({
        TableName: this.table,
        Item: { userId, sk: `ZONE#${tripId}#${t.at}`, kind: "transition", tripId, ...t, expiresAt: epoch(new Date()) + days(retentionDays) },
      }),
    );
  }

  async listTransitions(userId: string, tripId: string) {
    const items = await queryAll(this.db, {
      TableName: this.table,
      KeyConditionExpression: "userId = :u AND begins_with(sk, :p)",
      ExpressionAttributeValues: { ":u": userId, ":p": `ZONE#${tripId}#` },
    });
    return items.map((i) => ({ at: i.at as string, fromZoneId: (i.fromZoneId as string) ?? null, toZoneId: i.toZoneId as string, aqi: i.aqi as number }));
  }
}

// ---------------------------------------------------------------- Alerts

export class DynamoAlertsRepo implements AlertsRepo {
  constructor(private readonly table: string, private readonly db = documentClient()) {}

  async get(userId: string, alertId: string) {
    const res = await this.db.send(new GetCommand({ TableName: this.table, Key: { userId, sk: `ALERT#${alertId}` }, ConsistentRead: true }));
    return stripKeys<PollutionAlert>(res.Item, "sk", "expiresAt");
  }

  async listRecent(userId: string, limit: number) {
    const res = await this.db.send(
      new QueryCommand({
        TableName: this.table,
        IndexName: "byCreated",
        KeyConditionExpression: "userId = :u",
        ExpressionAttributeValues: { ":u": userId },
        ScanIndexForward: false,
        Limit: limit,
      }),
    );
    return (res.Items ?? []).map((i) => stripKeys<PollutionAlert>(i, "sk", "expiresAt")!);
  }

  async listForTrip(userId: string, tripId: string) {
    const items = await queryAll(this.db, {
      TableName: this.table,
      KeyConditionExpression: "userId = :u AND begins_with(sk, :p)",
      FilterExpression: "tripId = :t",
      ExpressionAttributeValues: { ":u": userId, ":p": "ALERT#", ":t": tripId },
      ConsistentRead: true,
    });
    return items.map((i) => stripKeys<PollutionAlert>(i, "sk", "expiresAt")!);
  }

  async createIfAbsent(alert: PollutionAlert, retentionDays: number) {
    try {
      await this.db.send(
        new PutCommand({
          TableName: this.table,
          Item: { ...alert, sk: `ALERT#${alert.id}`, expiresAt: epoch(new Date()) + days(retentionDays) },
          ConditionExpression: "attribute_not_exists(sk)",
        }),
      );
      return true;
    } catch (err) {
      if (isConditionalFailure(err)) return false;
      throw err;
    }
  }

  async claimDedupe(userId: string, key: string, alertId: string, ttlSeconds: number) {
    try {
      await this.db.send(
        new PutCommand({
          TableName: this.table,
          Item: { userId, sk: `DEDUPE#${key}`, alertId, expiresAt: epoch(new Date()) + ttlSeconds },
          ConditionExpression: "attribute_not_exists(sk)",
        }),
      );
      return true;
    } catch (err) {
      if (isConditionalFailure(err)) return false;
      throw err;
    }
  }

  async save(alert: PollutionAlert) {
    await this.db.send(
      new UpdateCommand({
        TableName: this.table,
        Key: { userId: alert.userId, sk: `ALERT#${alert.id}` },
        UpdateExpression: "SET #s = :s, updatedAt = :u, acknowledgedAt = :a",
        ConditionExpression: "attribute_exists(sk)",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: { ":s": alert.status, ":u": alert.updatedAt ?? new Date().toISOString(), ":a": alert.acknowledgedAt ?? null },
      }),
    );
  }

  async recordDelivery(userId: string, alertId: string, deviceId: string, outcome: DeliveryOutcome, detail: string | null) {
    try {
      await this.db.send(
        new PutCommand({
          TableName: this.table,
          Item: { userId, sk: `DELIVERY#${alertId}#${deviceId}`, outcome, detail, at: new Date().toISOString(), expiresAt: epoch(new Date()) + days(30) },
          ConditionExpression: "attribute_not_exists(sk)",
        }),
      );
      return true;
    } catch (err) {
      if (isConditionalFailure(err)) return false;
      throw err;
    }
  }

  async updateDelivery(userId: string, alertId: string, deviceId: string, outcome: DeliveryOutcome, detail: string | null) {
    await this.db.send(
      new UpdateCommand({
        TableName: this.table,
        Key: { userId, sk: `DELIVERY#${alertId}#${deviceId}` },
        UpdateExpression: "SET outcome = :o, detail = :d, at = :at",
        ExpressionAttributeValues: { ":o": outcome, ":d": detail, ":at": new Date().toISOString() },
      }),
    );
  }
}

// ---------------------------------------------------------------- Users

export class DynamoUsersRepo implements UsersRepo {
  constructor(private readonly table: string, private readonly db = documentClient()) {}

  async getPreferences(userId: string) {
    const res = await this.db.send(new GetCommand({ TableName: this.table, Key: { userId, sk: "PREFS" } }));
    return stripKeys<AlertPreferences>(res.Item, "userId", "sk");
  }

  async putPreferences(userId: string, prefs: AlertPreferences) {
    try {
      await this.db.send(
        new PutCommand({
          TableName: this.table,
          Item: { userId, sk: "PREFS", ...prefs },
          ConditionExpression: "attribute_not_exists(sk) OR updatedAt <= :u",
          ExpressionAttributeValues: { ":u": prefs.updatedAt },
        }),
      );
      return prefs;
    } catch (err) {
      if (!isConditionalFailure(err)) throw err;
      return (await this.getPreferences(userId)) ?? prefs;
    }
  }

  async listDevices(userId: string) {
    const items = await queryAll(this.db, {
      TableName: this.table,
      KeyConditionExpression: "userId = :u AND begins_with(sk, :p)",
      ExpressionAttributeValues: { ":u": userId, ":p": "DEVICE#" },
    });
    return items.map((i) => stripKeys<DeviceRecord>(i, "sk")!);
  }

  async putDevice(device: DeviceRecord) {
    await this.db.send(new PutCommand({ TableName: this.table, Item: { ...device, sk: `DEVICE#${device.deviceId}` } }));
  }

  async allow(userId: string, bucket: string, limit: number, windowSeconds: number, now: Date) {
    const window = Math.floor(epoch(now) / windowSeconds);
    try {
      await this.db.send(
        new UpdateCommand({
          TableName: this.table,
          Key: { userId, sk: `RATE#${bucket}#${window}` },
          UpdateExpression: "ADD hits :one SET expiresAt = :exp",
          ConditionExpression: "attribute_not_exists(hits) OR hits < :limit",
          ExpressionAttributeValues: { ":one": 1, ":limit": limit, ":exp": (window + 2) * windowSeconds },
        }),
      );
      return true;
    } catch (err) {
      if (isConditionalFailure(err)) return false;
      throw err;
    }
  }
}

// ---------------------------------------------------------------- Idempotency

export class DynamoIdempotencyRepo implements IdempotencyRepo {
  constructor(private readonly table: string, private readonly db = documentClient()) {}

  async get(scope: string, key: string) {
    const res = await this.db.send(new GetCommand({ TableName: this.table, Key: { id: `${scope}#${key}` } }));
    if (!res.Item || (res.Item.expiresAt as number) < epoch(new Date())) return null;
    return { status: res.Item.status as number, body: res.Item.body };
  }

  async put(scope: string, key: string, response: StoredResponse, ttlSeconds: number) {
    await this.db.send(
      new PutCommand({
        TableName: this.table,
        Item: { id: `${scope}#${key}`, status: response.status, body: response.body, expiresAt: epoch(new Date()) + ttlSeconds },
      }),
    );
  }
}

// ---------------------------------------------------------------- Pairing

export class DynamoPairingRepo implements PairingRepo {
  constructor(private readonly table: string, private readonly db = documentClient()) {}

  async create(record: PairingRecord) {
    try {
      await this.db.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: this.table,
                Item: { id: `CODE#${record.code}`, pairingId: record.pairingId, expiresAt: record.expiresAt },
                // A code may be reused only after its previous pairing expired.
                ConditionExpression: "attribute_not_exists(id) OR expiresAt < :now",
                ExpressionAttributeValues: { ":now": Math.floor(Date.parse(record.createdAt) / 1000) },
              },
            },
            { Put: { TableName: this.table, Item: { id: `PAIR#${record.pairingId}`, ...record }, ConditionExpression: "attribute_not_exists(id)" } },
          ],
        }),
      );
      return true;
    } catch (err) {
      if ((err as { name?: string }).name === "TransactionCanceledException") return false;
      throw err;
    }
  }

  async get(pairingId: string) {
    const res = await this.db.send(new GetCommand({ TableName: this.table, Key: { id: `PAIR#${pairingId}` }, ConsistentRead: true }));
    return stripKeys<PairingRecord>(res.Item, "id");
  }

  async getByCode(code: string) {
    const res = await this.db.send(new GetCommand({ TableName: this.table, Key: { id: `CODE#${code}` }, ConsistentRead: true }));
    return res.Item ? this.get(res.Item.pairingId as string) : null;
  }

  async approve(pairingId: string, user: { userId: string; username: string; email?: string }, nowEpoch: number) {
    try {
      await this.db.send(
        new UpdateCommand({
          TableName: this.table,
          Key: { id: `PAIR#${pairingId}` },
          UpdateExpression: "SET #s = :approved, userId = :uid, username = :un, email = :em, approvedAt = :at",
          ConditionExpression: "#s = :pending AND expiresAt > :now",
          ExpressionAttributeNames: { "#s": "status" },
          ExpressionAttributeValues: {
            ":approved": "approved",
            ":pending": "pending",
            ":uid": user.userId,
            ":un": user.username,
            ":em": user.email ?? null,
            ":at": new Date(nowEpoch * 1000).toISOString(),
            ":now": nowEpoch,
          },
        }),
      );
      return true;
    } catch (err) {
      if (isConditionalFailure(err)) return false;
      throw err;
    }
  }

  async consume(pairingId: string, nowEpoch: number) {
    try {
      await this.db.send(
        new UpdateCommand({
          TableName: this.table,
          Key: { id: `PAIR#${pairingId}` },
          UpdateExpression: "SET #s = :consumed",
          ConditionExpression: "#s = :approved AND expiresAt > :now",
          ExpressionAttributeNames: { "#s": "status" },
          ExpressionAttributeValues: { ":consumed": "consumed", ":approved": "approved", ":now": nowEpoch },
        }),
      );
      return true;
    } catch (err) {
      if (isConditionalFailure(err)) return false;
      throw err;
    }
  }
}

// ---------------------------------------------------------------- City (existing /infra tables, read-only)

const CITY_CACHE_MS = 60_000;

export class DynamoCityRepo implements CityRepo {
  private cache: { at: number; value: Awaited<ReturnType<CityRepo["loadDataset"]>> } | null = null;

  constructor(
    private readonly zonesTable: string | null,
    private readonly scenariosTable: string | null,
    private readonly provenance: "demo" | "verified" = "demo",
    private readonly db = documentClient(),
  ) {}

  async loadDataset() {
    if (!this.zonesTable) return null;
    if (this.cache && Date.now() - this.cache.at < CITY_CACHE_MS) return this.cache.value;
    const res = await this.db.send(new ScanCommand({ TableName: this.zonesTable, Limit: 200 }));
    const value = datasetFromItems((res.Items as Record<string, unknown>[]) ?? [], this.provenance);
    this.cache = { at: Date.now(), value };
    return value;
  }

  async latestScenario(): Promise<{ scenario: Scenario; savedAt: string } | null> {
    if (!this.scenariosTable) return null;
    const res = await this.db.send(new ScanCommand({ TableName: this.scenariosTable, Limit: 200 }));
    const newest = ((res.Items as Record<string, unknown>[]) ?? [])
      .filter((i) => typeof i.createdAt === "string")
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
    if (!newest) return null;
    return { scenario: normalizeScenario(newest as Partial<Scenario>), savedAt: newest.createdAt as string };
  }
}
