// GET /scenarios — latest saved snapshots; POST /scenarios — save one.
// A snapshot stores only the scenario inputs (preset + time step); readings are
// re-derived deterministically by the app, so nothing here is a measurement.
import { randomUUID } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.SCENARIOS_TABLE;
const PRESETS = new Set(["clear-morning", "traffic-haze", "winter-stagnation", "breezy-dispersal"]);
const TTL_DAYS = 30;

const json = (statusCode, body) => ({
  statusCode,
  headers: {
    "content-type": "application/json",
    "access-control-allow-origin": process.env.ALLOWED_ORIGIN ?? "",
  },
  body: JSON.stringify(body),
});

export async function handler(event) {
  try {
    if (event.httpMethod === "GET") {
      const res = await db.send(new ScanCommand({ TableName: TABLE, Limit: 100 }));
      const items = (res.Items ?? []).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 20);
      return json(200, { snapshots: items });
    }
    if (event.httpMethod === "POST") {
      let body;
      try {
        body = JSON.parse(event.body ?? "{}");
      } catch {
        return json(400, { error: "Body must be JSON" });
      }
      const { preset, timeIndex } = body;
      if (!PRESETS.has(preset) || !Number.isInteger(timeIndex) || timeIndex < 0 || timeIndex > 7) {
        return json(400, { error: "Expected { preset: <known preset>, timeIndex: 0–7 }" });
      }
      const now = new Date();
      const item = {
        id: randomUUID(),
        preset,
        timeIndex,
        createdAt: now.toISOString(),
        expiresAt: Math.floor(now.getTime() / 1000) + TTL_DAYS * 86400,
        kind: "simulated-scenario",
      };
      await db.send(new PutCommand({ TableName: TABLE, Item: item }));
      return json(201, item);
    }
    return json(405, { error: "Method not allowed" });
  } catch (err) {
    console.error("scenarios handler failed", err);
    return json(500, { error: "Scenario store unavailable" });
  }
}
