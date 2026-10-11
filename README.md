# AEROSCOPE — Delhi Air Intelligence

An explorable, stylised 3D digital twin of Delhi that shows how air quality differs across the city. Built with Next.js 16 (App Router), React Three Fiber and a deterministic scenario model.

> **Data status: DEMO.** Zone baselines are a hand-authored, deterministic demo dataset. They are not official or live readings. Every value on screen is derived through the simulated scenario model and labelled as simulated. The city layout is schematic, not survey accurate.

## Run locally

```bash
npm install
npm run dev          # http://localhost:3000
```

| Route | What it is |
| --- | --- |
| `/` | Landing page: what AEROSCOPE does, the watch journey, the architecture |
| `/simulation` | The full-screen 3D simulation (the route is defined once, in `lib/routes.ts`) |

| Script | What it does |
| --- | --- |
| `npm run dev` | Dev server (Turbopack) |
| `npm run build` / `npm start` | Production build / serve |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint (Next + React Compiler rules) |
| `npm test` | Vitest: AQI bands, PM sub-indices, scenario consistency, city generator, schema validation |

No environment variables are needed. Without them the app serves the bundled demo dataset from `/api/air-quality/zones`.

## Exploring

- **Mouse:** drag to pan · right-drag to rotate/tilt · scroll to zoom (toward the cursor) · click to select.
- **Touch:** one finger pans · pinch/two fingers zoom and rotate · tap selects.
- **Keyboard:** WASD/arrows pan · Q/E rotate · +/− zoom · `/` search · Esc deselect.
- Click any zone label, landmark, building, source pin, table row, alert or search result: the camera flies there, a pulsing ring marks it in the scene and the right panel shows AQI, PM2.5/PM10, temperature, wind, sources, a trend through the simulated day and provenance.

## What's in the scene

- Procedural city (≈2,500 instanced buildings, local street grid, trees, lamps, parked vehicles) packed on an occupancy grid so nothing overlaps roads, the river or landmarks.
- Landmarks: India Gate & Kartavya Path, Rashtrapati Bhavan, Connaught Place rings with the tricolour, New Delhi Railway Station yard, elevated metro viaduct and stations, Red Fort, Jama Masjid, Chandni Chowk bazaar, Yamuna with road/rail bridges and the Signature Bridge, Lodhi Garden tombs, AIIMS, a school, Nehru Place towers, Lotus Temple, Qutub Minar complex, Mayapuri industry, construction sites with animated cranes, Ghazipur landfill, NH-48 toll plaza, bus terminals and roadworks.
- Life: ~450 vehicles (cars, buses, trucks, vans, green-and-yellow autos) driving on the left, stopping at animated signals and following each other; two shuttling metro trains; a mainline train; river boats; drifting clouds; swaying trees.
- Lighting: Day / Sunset / Night (or follow the simulated clock) with lit windows, street-light pools, headlights, metro interiors and floodlit monuments.

## Air-quality model

- **Indian AQI bands** (CPCB) live in `lib/aqi.ts`: one classification + colour source for labels, badges, table, map, KPIs and the heatmap ramp. PM2.5 / PM10 sub-index breakpoints are implemented and tested so the displayed AQI always equals the max sub-index of the displayed concentrations.
- **17 zones** across 5 regions (`data/demo-zones.ts`) and 23 representative sources (`data/pollution-sources.ts`).
- **Scenario model** (`lib/simulation-engine.ts`): `AQI = baseline × preset load × mixing(time) × traffic factor × wind dilution`, clamped to 0–500. Eight 3-hourly time steps; four atmosphere presets (Clear Morning, Urban Traffic Haze, Winter Stagnation, Breezy Dispersal). Transparent and deterministic — not a forecast or dispersion model.
- **KPIs:** city average AQI and PM2.5 are simple means across zones (labelled, not population-weighted); high-pollution count = zones with AQI > 200.
- **Heatmap:** a GPU field interpolated between zone values (inverse-distance weighting) with isolines at band boundaries, also tinting rooftops. Plumes, ambient haze and wind streams are illustrative animations driven by the scenario wind vector.

## Architecture

```text
app/                      landing page (/), simulation page (/simulation), API routes
  api/air-quality/zones   provider-backed zone dataset (static when demo)
  api/scenarios           proxy to AWS scenario store (501 until configured)
components/
  AeroscopeApp.tsx        client shell; lazy-loads the WebGL canvas (ssr: false)
  world/                  R3F scene: ground, roads, buildings, landmarks, traffic,
                          metro, pollution layers, wind, labels, camera, interaction
  dashboard/              HUD: navigation, search, KPIs, panels, tables, timeline
  ui/                     small primitives (popover, AQI gauge/badge/scale)
  landing/                landing page sections, a lightweight R3F city diorama and
                          a scroll-driven replay of the watch demo journey (Motion)
data/                     zones, landmarks, regions, sources
lib/                      aqi, simulation engine, city layout + generator, paths,
                          shaders/uniforms, provider abstraction, schema validation
store/simulation-store.ts Zustand: dataset, scenario, derived readings, selection,
                          layers (persisted), camera requests
infra/                    AWS SAM stack (API Gateway + Lambda + DynamoDB)
infra/web/                Lambda + CloudFront hosting for the Next.js app
```

Readings, KPIs, table rows, labels, chart and heatmap uniforms are all derived from one `readings` array in the store. Per-frame animation (vehicles, trains, plumes, uniforms) lives in `useFrame`/shaders, never in React state. Repeated geometry is instanced.

## AWS integration (prepared, not deployed)

**Status: not deployed and not verified.** This repository contains the infrastructure and the integration code, but no AWS stack has been created from this environment and no live connection has been tested. The app does not claim a live connection: the status badge reports the dataset's provenance and whether the API call succeeded.

Stack (`infra/template.yaml`):

- API Gateway REST API, API-key protected, with a usage plan
- `GET /zones` → Lambda → DynamoDB `ZoneBaselines` table
- `GET|POST /scenarios` → Lambda → DynamoDB `ScenarioSnapshots` table (30-day TTL; stores only preset + time step)

Deploy:

```bash
cd infra
npm install
sam validate --lint
sam build
sam deploy --guided              # note the ApiUrl, ApiKeyId, ZoneBaselinesTableName outputs
ZONES_TABLE=<ZoneBaselinesTableName> AWS_REGION=<region> npm run seed   # loads the DEMO baseline
aws apigateway get-api-key --api-key <ApiKeyId> --include-value
```

Then configure the Next.js **server** environment (see `.env.example`):

```bash
AEROSCOPE_AQ_API_URL=https://<id>.execute-api.<region>.amazonaws.com/prod
AEROSCOPE_AQ_API_KEY=<key value>     # server-only; never NEXT_PUBLIC_
```

With the URL set, `/api/air-quality/zones` runs per request, validates the payload (`lib/zone-schema.ts`) and falls back to the bundled demo data with a reason if the remote call fails. Seeded data stays `provenance: "demo"`; set the stack's `BaselineProvenance=verified` only when the table is populated from a verified monitoring source.

### Hosting the web app (`infra/web/`)

The Next.js standalone server runs on Lambda (arm64, Node 22) through the [Lambda Web Adapter](https://github.com/awslabs/aws-lambda-web-adapter) with response streaming on a function URL, fronted by CloudFront (`/_next/static/*` cached, everything else passed through). No Docker needed.

```bash
# Set the data API URL at build time: without it the zones route is prerendered from the demo dataset.
AEROSCOPE_AQ_API_URL=<ApiUrl> ./infra/web/build.sh      # -> infra/web/.build/web.zip
sam deploy -t infra/web/template.yaml --stack-name aeroscope-web --region <region> \
  --resolve-s3 --capabilities CAPABILITY_IAM \
  --parameter-overrides AqApiUrl=<ApiUrl> \
    AqApiKey="$(aws apigateway get-api-key --api-key <ApiKeyId> --include-value --query value --output text)"
```

The `Url` output is the CloudFront address. Omit both parameters (and the build-time variable) to serve the bundled demo dataset. The function URL is public (`AuthType: NONE`) because CloudFront origin access control for Lambda cannot sign `POST` bodies from browsers.

## Limitations

- Stylised, schematic geography; landmark positions are arranged for legibility.
- Demo baselines and a multiplier model — no observed, historical or forecast data.
- Plumes, haze and wind are illustrative, not atmospheric physics.
