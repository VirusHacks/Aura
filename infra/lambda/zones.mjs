// GET /zones — returns the zone baseline dataset stored in DynamoDB.
// Response shape matches the app's ZoneDataset (validated again server-side).
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.ZONES_TABLE;
const PROVENANCE = process.env.BASELINE_PROVENANCE === "verified" ? "verified" : "demo";

const json = (statusCode, body) => ({
  statusCode,
  headers: {
    "content-type": "application/json",
    "access-control-allow-origin": process.env.ALLOWED_ORIGIN ?? "",
    "cache-control": "max-age=60",
  },
  body: JSON.stringify(body),
});

export async function handler() {
  try {
    const items = [];
    let ExclusiveStartKey;
    do {
      const page = await db.send(new ScanCommand({ TableName: TABLE, ExclusiveStartKey }));
      items.push(...(page.Items ?? []));
      ExclusiveStartKey = page.LastEvaluatedKey;
    } while (ExclusiveStartKey);

    const meta = items.find((i) => i.id === "__meta__");
    const zones = items.filter((i) => i.id !== "__meta__").sort((a, b) => a.id.localeCompare(b.id));
    if (zones.length === 0) {
      return json(503, { error: "Zone table is empty. Run infra/scripts/seed-zones.ts." });
    }
    return json(200, {
      provenance: PROVENANCE,
      sourceLabel: meta?.sourceLabel ?? (PROVENANCE === "verified" ? "Verified provider (DynamoDB)" : "Demo dataset served from AWS"),
      baselineTime: meta?.baselineTime ?? new Date().toISOString(),
      zones,
    });
  } catch (err) {
    console.error("zones handler failed", err);
    return json(500, { error: "Failed to read zone baselines" });
  }
}
