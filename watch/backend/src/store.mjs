// Persistence for the watch API. `MemoryStore` backs the local dev server and
// tests; `DynamoStore` backs Lambda with a single table:
//
//   pk = USER#<userId>   sk = AUTH | TRIP#<tripId> | ALERT#<alertId> | DEVICE#<deviceId> | PREFS | IDEMP#<key>
//   pk = GLOBAL          sk = SCENARIO   (operator override of the active scenario)
//
// Idempotency records expire after 7 days via the table's TTL attribute `expiresAt`.
import { bundledDataset, datasetFromItems } from "./city.mjs";

const IDEMPOTENCY_TTL_SECONDS = 7 * 86400;

export class MemoryStore {
  constructor({ dataset = bundledDataset() } = {}) {
    this.dataset = dataset;
    this.items = new Map();
    this.scenarioOverride = null;
  }
  key(userId, sk) {
    return `${userId}|${sk}`;
  }
  async getCity() {
    return this.dataset;
  }
  async getScenarioOverride() {
    return this.scenarioOverride;
  }
  async setScenarioOverride(scenario) {
    this.scenarioOverride = scenario;
  }
  async latestDashboardScenario() {
    return null;
  }
  async get(userId, sk) {
    const v = this.items.get(this.key(userId, sk));
    return v ? structuredClone(v) : null;
  }
  async put(userId, sk, value) {
    this.items.set(this.key(userId, sk), structuredClone(value));
  }
  async putIfAbsent(userId, sk, value) {
    if (this.items.has(this.key(userId, sk))) return false;
    await this.put(userId, sk, value);
    return true;
  }
  async list(userId, prefix) {
    const out = [];
    for (const [k, v] of this.items) if (k.startsWith(`${userId}|${prefix}`)) out.push(structuredClone(v));
    return out;
  }
}

export class DynamoStore {
  /**
   * @param {{ table: string, zonesTable?: string, snapshotsTable?: string, provenance?: string }} options
   */
  constructor(options) {
    this.options = options;
    this.cityCache = null;
  }

  async client() {
    if (!this.doc) {
      const { DynamoDBClient } = await import("@aws-sdk/client-dynamodb");
      const lib = await import("@aws-sdk/lib-dynamodb");
      this.lib = lib;
      this.doc = lib.DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
    }
    return this.doc;
  }

  /** Zone baselines from the existing AEROSCOPE table, cached for 60 s; bundled demo data otherwise. */
  async getCity() {
    if (this.cityCache && Date.now() - this.cityCache.at < 60_000) return this.cityCache.dataset;
    let dataset = null;
    if (this.options.zonesTable) {
      const doc = await this.client();
      const items = [];
      let ExclusiveStartKey;
      do {
        const page = await doc.send(new this.lib.ScanCommand({ TableName: this.options.zonesTable, ExclusiveStartKey }));
        items.push(...(page.Items ?? []));
        ExclusiveStartKey = page.LastEvaluatedKey;
      } while (ExclusiveStartKey);
      dataset = datasetFromItems(items, this.options.provenance);
    }
    dataset ??= bundledDataset();
    this.cityCache = { dataset, at: Date.now() };
    return dataset;
  }

  async getScenarioOverride() {
    return (await this.get("GLOBAL", "SCENARIO", true))?.scenario ?? null;
  }

  async setScenarioOverride(scenario) {
    await this.put("GLOBAL", "SCENARIO", { scenario, setAt: new Date().toISOString() }, true);
  }

  /** The scenario most recently saved from the 3D dashboard (existing ScenarioSnapshots table). */
  async latestDashboardScenario() {
    if (!this.options.snapshotsTable) return null;
    const doc = await this.client();
    const res = await doc.send(new this.lib.ScanCommand({ TableName: this.options.snapshotsTable, Limit: 100 }));
    const latest = (res.Items ?? []).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
    return latest ? { preset: latest.preset, timeIndex: latest.timeIndex } : null;
  }

  pk(userId, global) {
    return global ? "GLOBAL" : `USER#${userId}`;
  }

  async get(userId, sk, global = false) {
    const doc = await this.client();
    const res = await doc.send(new this.lib.GetCommand({ TableName: this.options.table, Key: { pk: this.pk(userId, global), sk } }));
    return res.Item?.data ?? null;
  }

  async put(userId, sk, value, global = false) {
    const doc = await this.client();
    const item = { pk: this.pk(userId, global), sk, data: value };
    if (sk.startsWith("IDEMP#")) item.expiresAt = Math.floor(Date.now() / 1000) + IDEMPOTENCY_TTL_SECONDS;
    await doc.send(new this.lib.PutCommand({ TableName: this.options.table, Item: item }));
  }

  /** Conditional write; false when the item already exists. */
  async putIfAbsent(userId, sk, value) {
    const doc = await this.client();
    try {
      await doc.send(new this.lib.PutCommand({
        TableName: this.options.table,
        Item: { pk: this.pk(userId), sk, data: value },
        ConditionExpression: "attribute_not_exists(pk)",
      }));
      return true;
    } catch (err) {
      if (err?.name === "ConditionalCheckFailedException") return false;
      throw err;
    }
  }

  async list(userId, prefix) {
    const doc = await this.client();
    const out = [];
    let ExclusiveStartKey;
    do {
      const res = await doc.send(new this.lib.QueryCommand({
        TableName: this.options.table,
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
        ExpressionAttributeValues: { ":pk": this.pk(userId), ":prefix": prefix },
        ExclusiveStartKey,
      }));
      out.push(...(res.Items ?? []).map((i) => i.data));
      ExclusiveStartKey = res.LastEvaluatedKey;
    } while (ExclusiveStartKey && out.length < 500);
    return out;
  }
}
