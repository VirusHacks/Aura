// City dataset for the watch API: zone baselines from the existing AEROSCOPE
// `ZoneBaselines` table when configured, otherwise the bundled demo dataset.
// Geo anchors and road links always come from the bundled file, which is
// byte-identical to the watch app's copy.
import { readFileSync } from "node:fs";

const bundledUrl = new URL("./data/delhi-zones.json", import.meta.url);
export const BUNDLED = JSON.parse(readFileSync(bundledUrl, "utf8"));

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

/** Same defaults and validation as the web app's lib/zone-schema.ts. */
export function normalizeZone(raw) {
  if (!raw || typeof raw !== "object" || typeof raw.id !== "string" || typeof raw.name !== "string") return null;
  const pos = raw.position;
  if (!Array.isArray(pos) || pos.length !== 2 || !isNum(pos[0]) || !isNum(pos[1])) return null;
  if (!isNum(raw.baseAqi) || raw.baseAqi < 0 || raw.baseAqi > 500) return null;
  return {
    id: raw.id,
    name: raw.name,
    region: typeof raw.region === "string" ? raw.region : "central",
    position: [pos[0], pos[1]],
    radius: isNum(raw.radius) ? raw.radius : 14,
    baseAqi: raw.baseAqi,
    dominant: raw.dominant === "PM10" ? "PM10" : "PM2.5",
    trafficShare: isNum(raw.trafficShare) ? Math.min(1, Math.max(0, raw.trafficShare)) : 0.4,
    baseTemperature: isNum(raw.baseTemperature) ? raw.baseTemperature : 22,
    sources: Array.isArray(raw.sources) ? raw.sources.filter((s) => typeof s === "string") : [],
    description: typeof raw.description === "string" ? raw.description : "",
    geo: raw.geo && isNum(raw.geo.lat) && isNum(raw.geo.lon) ? { lat: raw.geo.lat, lon: raw.geo.lon } : undefined,
  };
}

/** Adds geo anchors and links from the bundled dataset to zones that lack them. */
export function enrich(dataset) {
  const ref = Object.fromEntries(BUNDLED.zones.map((z) => [z.id, z]));
  return {
    ...dataset,
    zones: dataset.zones.map((z) => (z.geo || !ref[z.id] ? z : { ...z, geo: ref[z.id].geo })),
    links: dataset.links?.length ? dataset.links : BUNDLED.links,
  };
}

export function bundledDataset() {
  return enrich({ ...BUNDLED, zones: BUNDLED.zones.map(normalizeZone).filter(Boolean) });
}

/** Builds a dataset from `ZoneBaselines` items (as written by infra/scripts/seed-zones.ts). */
export function datasetFromItems(items, provenance) {
  const meta = items.find((i) => i.id === "__meta__");
  const zones = items.filter((i) => i.id !== "__meta__").map(normalizeZone).filter(Boolean).sort((a, b) => a.id.localeCompare(b.id));
  if (zones.length === 0) return null;
  return enrich({
    provenance: provenance === "verified" ? "verified" : "demo",
    sourceLabel: meta?.sourceLabel ?? "Demo dataset served from AWS",
    baselineTime: meta?.baselineTime ?? new Date().toISOString(),
    zones,
    links: [],
  });
}
