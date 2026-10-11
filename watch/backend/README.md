# AEROSCOPE watch backend

Trips, location evaluation, pollution alerts, cleaner-route comparison and APNs push
for the Apple Watch app. Contract: [`../docs/API.md`](../docs/API.md).

| File | Role |
| --- | --- |
| `src/engine.mjs` | AQI bands, scenario model, geo matching, route planner, alert rules — mirrors `AeroscopeKit` |
| `src/app.mjs` | HTTP-agnostic API (routing, validation, idempotency, side effects) |
| `src/store.mjs` | `MemoryStore` (dev/tests) and `DynamoStore` (single table + existing AEROSCOPE tables) |
| `src/notify.mjs` | SNS → APNs push, AppSync Events publish, CloudWatch EMF metrics |
| `src/lambda.mjs` | API Gateway proxy adapter |
| `src/data/delhi-zones.json` | Zone baselines + geo anchors + road links (identical to the watch app's copy; a test enforces it) |
| `dev-server.mjs` | Local server on :8787 with an SSE event stream at `/v1/stream` |
| `template.yaml` | SAM stack (API Gateway, Lambda, DynamoDB, alarms) |

```bash
npm run dev     # local API, in-memory, bundled demo baselines
npm test        # 18 tests: 544-row parity with the web engine, alert rules, auth, full API flows
sam build && sam deploy --guided --parameter-overrides ZonesTableName=<…> ScenarioSnapshotsTableName=<…>
```

No npm dependencies: the Lambda uses the AWS SDK v3 bundled with the `nodejs22.x`
runtime, loaded lazily so local runs never need it.
