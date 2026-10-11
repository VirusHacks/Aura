/**
 * Stage configuration from CDK context (cdk.json → context.stages.<stage>, or
 * `-c stage=<name>`). Non-secret settings only: no account ids, keys or tokens.
 */
import type { App } from "aws-cdk-lib";

export interface StageConfig {
  stage: string;
  region: string;
  /** The deployed dashboard (CloudFront) origin, allowed by CORS. */
  webUrl: string;
  devOrigins: string[];
  /** Existing /infra stack tables the backend reads (zone baselines, dashboard scenarios). */
  zonesTableName: string;
  scenariosTableName: string;
  baselineProvenance: "demo" | "verified";
  routing: "amazon-location" | "demo-zone-graph";
  apnsPlatformArnSandbox: string;
  apnsPlatformArnProduction: string;
  alarmEmail: string;
  /** Existing S3 bucket that receives Lambda bundles and templates (no CDK bootstrap needed). */
  assetsBucket: string;
  logRetentionDays: number;
  locationRetentionDays: number;
}

export function stageConfig(app: App): StageConfig {
  const stage = (app.node.tryGetContext("stage") as string) ?? "dev";
  const stages = (app.node.tryGetContext("stages") ?? {}) as Record<string, Partial<StageConfig>>;
  const raw = stages[stage];
  if (!raw) throw new Error(`No configuration for stage "${stage}" in cdk.json context.stages`);
  const required = ["region", "webUrl", "assetsBucket"] as const;
  for (const key of required) if (!raw[key]) throw new Error(`stages.${stage}.${key} is required`);
  return {
    stage,
    region: raw.region!,
    webUrl: raw.webUrl!.replace(/\/$/, ""),
    devOrigins: raw.devOrigins ?? [],
    zonesTableName: raw.zonesTableName ?? "",
    scenariosTableName: raw.scenariosTableName ?? "",
    baselineProvenance: raw.baselineProvenance === "verified" ? "verified" : "demo",
    routing: raw.routing === "amazon-location" ? "amazon-location" : "demo-zone-graph",
    apnsPlatformArnSandbox: raw.apnsPlatformArnSandbox ?? "",
    apnsPlatformArnProduction: raw.apnsPlatformArnProduction ?? "",
    alarmEmail: raw.alarmEmail ?? "",
    assetsBucket: raw.assetsBucket!,
    logRetentionDays: raw.logRetentionDays ?? 14,
    locationRetentionDays: raw.locationRetentionDays ?? 30,
  };
}
