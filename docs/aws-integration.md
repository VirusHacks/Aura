# AWS integration milestones

This document explains how the AWS parts of AEROSCOPE fit together. It is written as a project map, not as a claim that every stack has already been deployed.

## Milestone 1: serve shared air-quality data

The first cloud layer is the SAM stack in [`infra/`](../infra/). It exposes zone baselines and scenario snapshots through API Gateway and stores them in DynamoDB.

Relevant implementation:

- [`infra/template.yaml`](../infra/template.yaml)
- [`infra/lambda/zones.mjs`](../infra/lambda/zones.mjs)
- [`infra/lambda/scenarios.mjs`](../infra/lambda/scenarios.mjs)
- [`lib/air-quality-provider.ts`](../lib/air-quality-provider.ts)
- [`app/api/air-quality/zones/route.ts`](../app/api/air-quality/zones/route.ts)

This layer lets the web server use a shared provider while still falling back to the bundled demo data when AWS is not configured.

## Milestone 2: add identity and user-owned state

The live CDK data stack adds Cognito and user-owned DynamoDB tables. Cognito provides identities for the dashboard, iPhone and watch pairing flow. The tables store trips, alerts, preferences, pairing records and idempotency keys.

Relevant implementation:

- [`cloud/lib/data-stack.ts`](../cloud/lib/data-stack.ts)
- [`app/api/auth/[action]/route.ts`](../app/api/auth/%5Baction%5D/route.ts)
- [`cloud/functions/handlers/auth-challenge.ts`](../cloud/functions/handlers/auth-challenge.ts)
- [`cloud/functions/repo/dynamo.ts`](../cloud/functions/repo/dynamo.ts)

The user identity is carried through the request so one user's trip and alerts are not exposed to another user.

## Milestone 3: evaluate trips and routes

The application Lambda functions apply the same scenario model used by the web and watch experiences. They match a GPS or simulated world position to a zone, calculate the reading, evaluate alert rules and compare routes.

Relevant implementation:

- [`cloud/functions/domain/evaluate.ts`](../cloud/functions/domain/evaluate.ts)
- [`cloud/functions/domain/trips.ts`](../cloud/functions/domain/trips.ts)
- [`cloud/functions/domain/alerts.ts`](../cloud/functions/domain/alerts.ts)
- [`cloud/functions/domain/routing/compare.ts`](../cloud/functions/domain/routing/compare.ts)
- [`cloud/functions/domain/routing/amazon-location.ts`](../cloud/functions/domain/routing/amazon-location.ts)

Amazon Location Service supplies route candidates when the configured routing provider is `amazon-location`. AEROSCOPE adds pollution exposure scoring on top of the route geometry.

## Milestone 4: publish events and notify devices

Important changes are emitted as domain events. EventBridge routes those events to the realtime publisher and notification service.

```text
Trip or alert Lambda
    → EventBridge event bus
    ├─→ AppSync Events → web dashboard
    └─→ SNS/APNs → Apple Watch notification
```

Relevant implementation:

- [`cloud/functions/services/events.ts`](../cloud/functions/services/events.ts)
- [`cloud/functions/services/realtime.ts`](../cloud/functions/services/realtime.ts)
- [`cloud/functions/services/push.ts`](../cloud/functions/services/push.ts)
- [`cloud/functions/handlers/realtime-publisher.ts`](../cloud/functions/handlers/realtime-publisher.ts)
- [`cloud/functions/handlers/notifier.ts`](../cloud/functions/handlers/notifier.ts)
- [`cloud/appsync/user-channel.js`](../cloud/appsync/user-channel.js)

Retries and dead-letter queues are configured for the realtime and notification paths. That matters because a temporary notification failure should not make the trip state disappear.

## Milestone 5: host and observe the system

The web deployment under [`infra/web/`](../infra/web/) packages the Next.js standalone server behind a Lambda Web Adapter and CloudFront. CloudWatch receives logs, metrics and alarms from the live backend.

Relevant implementation:

- [`infra/web/template.yaml`](../infra/web/template.yaml)
- [`infra/web/build.sh`](../infra/web/build.sh)
- [`cloud/lib/app-stack.ts`](../cloud/lib/app-stack.ts)
- [`cloud/lib/function.ts`](../cloud/lib/function.ts)

The infrastructure is defined with AWS SAM, CDK and CloudFormation so the setup can be reproduced instead of being configured manually in the AWS console.

## Local-to-AWS progression

The project is designed to be explored in this order:

1. Run the web app with the bundled demo dataset.
2. Run the local watch backend and exercise trips and alerts without AWS.
3. Deploy the base `infra/` data API.
4. Deploy the `cloud/` live backend with Cognito and user-owned tables.
5. Configure the web app and iPhone/watch clients with the deployed endpoints.
6. Enable optional Amazon Location, SNS/APNs and AppSync Events integrations.

This separation keeps the demo usable while leaving a clear path to a multi-user cloud deployment.
