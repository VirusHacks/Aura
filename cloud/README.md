# AEROSCOPE live AWS backend

The `cloud/` folder contains the larger live backend for trips, alerts, route selection and device communication. It is separate from the smaller `infra/` data API, but it can read the zone and scenario tables created there.

## How a request moves through the backend

```text
Web app / iPhone / Apple Watch
    → API Gateway HTTP API
    → Cognito identity check
    → Lambda handler
    → domain logic + DynamoDB
    → response and domain event
```

The main application pieces are:

- `functions/app/` — HTTP routes and request handling
- `functions/domain/` — trip state, AQI evaluation, alerts and route scoring
- `functions/repo/` — DynamoDB and in-memory repositories
- `functions/services/` — EventBridge, push and realtime integrations
- `lib/data-stack.ts` — Cognito and persistent application tables
- `lib/app-stack.ts` — HTTP API, Lambda functions, events, routing and monitoring

## AWS services in this layer

### Identity and API access

Amazon Cognito provides separate clients for the web dashboard, iPhone companion and watch pairing flow. API Gateway exposes the HTTP API and uses the Cognito identity in the request.

### Application data

Lambda functions read and write DynamoDB tables for trips, alerts, users, idempotency and watch pairing. Tables use on-demand billing, encryption, point-in-time recovery where appropriate and retention policies designed to protect user data during redeployments.

### Route recommendations

The route service can call Amazon Location Service for route candidates. AEROSCOPE then scores those candidates against zone AQI values, estimated exposure and the user's travel mode.

### Events, notifications and realtime updates

Trip and alert changes are published to an EventBridge bus. Rules send those events to:

- A realtime publisher for AppSync Events user channels
- A notifier that sends Apple Push Notifications through SNS when configured

Both event paths use retries and dead-letter queues so a temporary downstream failure does not silently lose an alert.

### Monitoring

CloudWatch receives Lambda logs, API metrics, custom application metrics and alarms. The stack also keeps separate dead-letter queues for realtime and notification failures.

## Local development

```bash
cd cloud
npm install
npm run typecheck
npm test
npm run dev
```

The local development server uses an in-memory repository and does not require an AWS account. This makes it possible to test the same trip, alert and route flows before deployment.

## Deployment

The CDK entry point is `bin/aeroscope.ts`. Deployment is intentionally separate from the base `infra/` stack because the live backend needs Cognito, user-owned tables, event routing and optional notification credentials.

```bash
cd cloud
npm install
npm run synth
npm run deploy:plan
npm run deploy:execute
```

Review the generated plan before executing it. The live stack is prepared in code but is not claimed as deployed or verified by the repository documentation.
