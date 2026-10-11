# AEROSCOPE base AWS data API

This folder contains the first AWS layer used by AEROSCOPE. It provides the web app with a protected data API for zone baselines and saved simulation scenarios.

## What this stack does

`template.yaml` creates:

- API Gateway REST API with an API key and usage plan
- `ZoneBaselines` DynamoDB table
- `ScenarioSnapshots` DynamoDB table with TTL cleanup
- Lambda function for `GET /zones`
- Lambda function for `GET|POST /scenarios`
- CloudFormation outputs for the API URL, API key ID and table names

The Next.js server calls this API server-to-server. The API key is never sent to the browser.

## Data flow

```text
Next.js server
    → API Gateway
    → Lambda
    → DynamoDB
    → validated zone/scenario response
```

If this stack is not configured, the web app uses the bundled demo dataset. If the remote API is configured but temporarily fails, the web route validates the response and falls back to the demo data with a reason.

## Deploy

```bash
cd infra
npm install
sam validate --lint
sam build
sam deploy --guided
```

After deployment, seed the zone table and configure the Next.js server:

```bash
ZONES_TABLE=<ZoneBaselinesTableName> AWS_REGION=<region> npm run seed

AEROSCOPE_AQ_API_URL=https://<api-id>.execute-api.<region>.amazonaws.com/prod
AEROSCOPE_AQ_API_KEY=<api-key-value>
```

Keep `AEROSCOPE_AQ_API_KEY` server-only. Do not expose it through a `NEXT_PUBLIC_` environment variable.

## Important limitation

The bundled and seeded dataset is marked as `demo`. Change the provenance to `verified` only after loading data from a verified monitoring source.
