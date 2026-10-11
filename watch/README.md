# AEROSCOPE Watch

Native Apple Watch app (with a minimal iPhone companion and backend) for AEROSCOPE,
the Delhi air-quality digital twin. Start a trip, and the watch matches your position
(or a simulated one) to a zone of the 3D city, warns you before you walk into poor
air, offers a cleaner route, and reports every step to the backend so the dashboard
can move your avatar.

```
watch/
├── AeroscopeWatch.xcodeproj   Xcode project: watchOS app + iPhone companion (embeds the watch app)
├── AeroscopeWatch/            watchOS app — SwiftUI views, WatchKit delegate, haptics
├── AeroscopeCompanion/        iOS companion — connection, preferences, activity, demo remote
├── AeroscopeKit/              Swift package shared by both apps (all logic + 89 XCTests)
├── Config/                    xcconfig, Info.plist fragments, entitlements
├── backend/                   AWS SAM stack + Lambda + local dev server (Node 22, 18 tests)
└── docs/API.md                HTTP contract, real-time events, push payload
```

Nothing outside `watch/` was changed. The web app and its `infra/` stack are used as-is.

## What it does

**Watch — four vertical pages plus an alert sheet**

1. **Air** — AQI ring with number and category text (never colour alone), zone,
   PM2.5, "updated … ago", a **LIVE / CACHED / DEMO** badge, stale-data and
   last-known-zone warnings, Start/End Trip.
2. **Trip** — elapsed active time (pauses excluded; minutes-only in always-on mode),
   current zone and AQI, destination and next zone, time-weighted average and peak
   exposure, zones, alerts, reroutes; Pause / Resume / End.
3. **Alert** (sheet, haptic) — "Poor air ahead", AQI, zone, PM2.5, CPCB health
   advice, origin (AEROSCOPE / OFFLINE ESTIMATE / DEMO). Actions: **Cleaner route**,
   **Got it**, **Dismiss**.
4. **Routes** — current vs cleaner route: via-zones, distance, minutes, average and
   peak AQI, exposure reduction. **Take cleaner route** updates the trip, the backend
   and (in demo) the simulated walk. Without a destination it suggests the nearest
   cleaner zone.
5. **Alerts** list and **Settings** — data source, threshold, sensitive group,
   look-ahead, cooldown, travel mode, permissions, demo scenario controls, sync status.

Notifications use the actionable `AQI_ALERT` category (**Cleaner route** / **Got it**)
for both local alerts and APNs pushes.

**iPhone companion** — backend URL and API key (Keychain), connection test, watch link
and permission guidance, alert preferences, recent trips and alerts, demo remote
(mode, scenario, advance, restart, "pollution spike"), and a relay queue that delivers
actions the watch couldn't send.

## Run it (simulator, ~2 minutes, no AWS)

Requires Xcode 26+ (built and tested with Xcode 27 / watchOS 27 SDK; deployment
targets watchOS 10, iOS 17).

1. Open `AeroscopeWatch.xcodeproj`, pick the **AeroscopeWatch** scheme and an Apple
   Watch simulator, Run.
2. On the watch, swipe to **Settings → Data → Demo** (or tap **Try Demo** on the
   empty Air screen).
3. **Start Trip → Red Fort Precinct**. The simulated position walks
   Lodhi Garden → India Gate → … every 8 s (or tap **Advance demo**). At India Gate
   you get **"Poor air ahead — Connaught Place 236"**. Tap **Cleaner route** →
   **Take cleaner route** (via Yamuna Riverfront, about 20 % less exposure).

The demo is deterministic: same route, same scenario, same numbers every time, and
identical to the 3D dashboard for the same preset and time (Urban Traffic Haze, 15:00).

### Live mode against the local backend

```bash
cd watch/backend && npm run dev            # http://localhost:8787, in-memory, demo baselines
```

- iPhone app → **Status → Connect backend** → `http://localhost:8787` (or set
  `AEROSCOPE_API_BASE_URL` in `Config/Local.xcconfig`).
- Watch simulator: **Features → Location → Custom Location** `28.6315, 77.2167`
  (Connaught Place). Outside Delhi the app says "Outside Delhi coverage" rather than
  inventing a reading.
- Move the avatar from your laptop and watch the alert arrive (operator routes are
  open on the dev server unless `AEROSCOPE_OPERATOR_KEY` is set):

```bash
curl -N localhost:8787/v1/stream                                  # dashboard event feed
curl -X PUT localhost:8787/v1/scenario -H 'content-type: application/json' \
     -d '{"preset":"traffic-haze","timeIndex":3}'
curl -X POST localhost:8787/v1/trips/<tripId>/simulate -H 'x-aeroscope-user: <userId>' \
     -H 'content-type: application/json' -d '{"zoneId":"z-an"}'
```

(`tripId` and `userId` are in the dev server log.)

## Deploy the backend (AWS)

`backend/template.yaml` is a separate SAM stack that **reads** the existing stack's
tables; it does not modify `infra/`. Not deployed or verified from this environment.

```bash
cd watch/backend
sam build && sam deploy --guided \
  --parameter-overrides ZonesTableName=<ZoneBaselinesTableName> \
                        ScenarioSnapshotsTableName=<ScenarioSnapshotsTableName>
aws apigateway get-api-key --api-key <WatchApiKeyId> --include-value
```

Enter `WatchApiUrl` and the key in the iPhone app. Optional parameters:

| Parameter | Enables |
| --- | --- |
| `ApnsPlatformApplicationArnSandbox` / `…Production` | Pushes via SNS. Create an SNS platform application (APNS_SANDBOX / APNS, token auth) whose bundle id is the **watch** app's (`<prefix>.companion.watchkitapp`). |
| `AppSyncEventsHttpDomain` + `AppSyncEventsApiKey` | Real-time events for the dashboard (create an AppSync Events API with an `aeroscope` namespace). |
| `OperatorKey` | The demo operator routes (`/simulate`, `PUT /v1/scenario`), sent as `x-aeroscope-operator-key`. Empty keeps them disabled. |

Includes: API Gateway (API key + usage plan, X-Ray), one Lambda, a DynamoDB single
table with TTL and PITR, 14-day logs, a Lambda-errors alarm, and EMF metrics in
`Aeroscope/Watch` (`AlertsRaised`, `PushesSent`, `PushFailures`, `AuthFailures`, …).
SNS permissions are scoped to the configured platform applications and their device
endpoints, and are omitted when push is off. `cfn-lint` passes.

**Security model.** The API key only meters access, and every watch carries it. Users are
authenticated by `x-aeroscope-user` + `x-aeroscope-user-key`: a per-installation secret
in the Keychain whose hash the backend pins on first use. The iPhone hands its id and
key to the watch in one WatchConnectivity message, so both act as the same user.
Operator routes need a separate key. The `OperatorKey` and AppSync key are plain Lambda
environment variables; move them to Secrets Manager or SSM SecureString for production.

## Tests

```bash
cd watch/AeroscopeKit && swift test                 # 89 XCTests on macOS (1 skipped: live contract)
cd watch/backend && npm test                        # 18 node:test tests
# Swift client against the real Node API:
(cd watch/backend && PORT=8799 node dev-server.mjs) &
cd watch/AeroscopeKit && AEROSCOPE_DEV_SERVER=http://localhost:8799 swift test --filter LiveContractTests
```

Covered: every AQI boundary; **all 544 zone × preset × time readings equal the web
engine** (Swift and JS both check a fixture generated from `lib/simulation-engine.ts`);
bundled baselines equal the web's `DEMO_ZONES`; geo matching and projection; route
choice; every alert rule; trip state machine and exposure maths; offline queue
ordering, persistence, shedding, idempotency and the iPhone relay; HTTP request shape
and error mapping; and end-to-end model workflows (demo trip → alert → reroute,
offline → sync, live never falls back to demo, relaunch recovery).

## Design notes

- **All logic lives in `AeroscopeKit`.** `AeroscopeModel` (watch) and `CompanionModel`
  (iPhone) are `@Observable @MainActor` classes with Core Location, notifications,
  haptics and WatchConnectivity injected as protocols, so workflows run in unit tests.
- **One code path for demo and live.** `DemoBackend` (an actor) implements the same
  `AeroscopeBackend` protocol as `LiveBackendClient`; only the badge differs.
- **Honest data status.** LIVE ages to CACHED after 10 min and is flagged stale after
  30; snapshots restored from disk are never LIVE; each mode keeps its own last reading,
  so a demo value can never appear in live mode; stale data never triggers an alert;
  offline estimates come only from city data previously fetched from the backend.
- **Offline first.** Every state change becomes a `PendingAction` whose UUID is the
  `Idempotency-Key`. Delivery is FIFO and stops at the first retryable error; when the
  watch is offline it hands the queue to the iPhone, which delivers and acknowledges.
  Delivering twice is harmless.
- **Alerts** fire once per zone per category per trip, respect a cooldown unless the
  air gets worse, look one zone ahead on the planned route, and drop one category for
  sensitive groups. The backend runs the same rules in JavaScript.
- **Location**: one-shot fixes when idle; continuous updates during a trip, continuing
  in the background only because `UIBackgroundModes` declares `location` (checked at
  runtime before enabling).

## Limits and next steps

- The web dashboard does not yet subscribe to the trip events; it needs a small
  AppSync Events client that moves the avatar to `trip.location.world`
  (see `docs/API.md`). That change belongs in the Next.js app, outside `watch/`.
- No Cognito: identity is a per-installation key (above), which ties data to the device
  rather than a person and is lost if the Keychain item is. The Lambda already prefers a
  Cognito `sub` when an authorizer is attached.
- Watch readings are the scenario model's simulated values, like the dashboard's —
  not measurements.
- Pushes need a paid developer team (remove `aps-environment` from
  `Config/AeroscopeWatch.entitlements` for a free team). Set `DEVELOPMENT_TEAM` and
  `AEROSCOPE_BUNDLE_PREFIX` in `Config/Local.xcconfig` for device builds.
- Not included: a watch-face complication (WidgetKit) and HealthKit workout sessions
  for longer background runtime.
