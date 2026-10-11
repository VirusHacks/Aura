import type { DataProvenance, RegionId, SourceCategory, ZoneBaseline, ZoneDataset } from "../types/air-quality";

const REGIONS: RegionId[] = ["central", "old", "east", "south", "industrial"];
const CATEGORIES: SourceCategory[] = ["traffic", "construction", "industrial", "commercial", "waste-burning"];

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === "string" && v.length > 0;

/** Validate an untrusted payload (API / AWS) into a ZoneDataset, or throw with a reason. */
export function parseZoneDataset(input: unknown): ZoneDataset {
  if (!input || typeof input !== "object") throw new Error("Dataset is not an object");
  const o = input as Record<string, unknown>;
  const provenance: DataProvenance = o.provenance === "verified" ? "verified" : "demo";
  if (!Array.isArray(o.zones) || o.zones.length === 0) throw new Error("Dataset has no zones");
  const zones: ZoneBaseline[] = o.zones.map((z, i) => {
    if (!z || typeof z !== "object") throw new Error(`Zone ${i} is not an object`);
    const r = z as Record<string, unknown>;
    const pos = r.position as unknown[];
    if (!isStr(r.id) || !isStr(r.name)) throw new Error(`Zone ${i} is missing id/name`);
    if (!REGIONS.includes(r.region as RegionId)) throw new Error(`Zone ${r.id} has an unknown region`);
    if (!Array.isArray(pos) || pos.length !== 2 || !isNum(pos[0]) || !isNum(pos[1])) throw new Error(`Zone ${r.id} has no position`);
    if (!isNum(r.baseAqi) || r.baseAqi < 0 || r.baseAqi > 500) throw new Error(`Zone ${r.id} has an invalid AQI`);
    return {
      id: r.id,
      name: r.name,
      region: r.region as RegionId,
      position: [pos[0], pos[1]],
      radius: isNum(r.radius) ? r.radius : 14,
      baseAqi: r.baseAqi,
      dominant: r.dominant === "PM10" ? "PM10" : "PM2.5",
      trafficShare: isNum(r.trafficShare) ? Math.min(1, Math.max(0, r.trafficShare)) : 0.4,
      baseTemperature: isNum(r.baseTemperature) ? r.baseTemperature : 22,
      sources: Array.isArray(r.sources) ? (r.sources.filter((c) => CATEGORIES.includes(c as SourceCategory)) as SourceCategory[]) : [],
      description: typeof r.description === "string" ? r.description : "",
    };
  });
  return {
    provenance,
    sourceLabel: isStr(o.sourceLabel) ? o.sourceLabel : provenance === "verified" ? "Verified provider" : "Demo dataset",
    baselineTime: isStr(o.baselineTime) ? o.baselineTime : new Date(0).toISOString(),
    zones,
  };
}
