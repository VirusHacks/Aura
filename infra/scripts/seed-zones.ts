/**
 * Seeds the ZoneBaselines table with the bundled DEMO dataset.
 *
 *   cd infra && npm install
 *   ZONES_TABLE=<table name> AWS_REGION=<region> npm run seed
 *
 * Uses your local AWS credentials (profile / env). The data written is the
 * same illustrative demo baseline the app ships with — not measurements.
 */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { BatchWriteCommand, DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { DEMO_DATASET } from "../../data/demo-zones.ts";

const table = process.env.ZONES_TABLE;
if (!table) {
  console.error("Set ZONES_TABLE to the ZoneBaselinesTableName stack output.");
  process.exit(1);
}

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const items = [
  { id: "__meta__", sourceLabel: "Demo dataset served from AWS (illustrative, not measured)", baselineTime: DEMO_DATASET.baselineTime },
  ...DEMO_DATASET.zones,
];

for (let i = 0; i < items.length; i += 25) {
  const chunk = items.slice(i, i + 25);
  await db.send(new BatchWriteCommand({ RequestItems: { [table]: chunk.map((Item) => ({ PutRequest: { Item } })) } }));
  console.log(`Wrote ${Math.min(i + 25, items.length)}/${items.length}`);
}
console.log("Seed complete (provenance: demo).");
