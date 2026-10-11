import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Duration, RemovalPolicy } from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { NodejsFunction, OutputFormat } from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import type { Construct } from "constructs";

const here = path.dirname(fileURLToPath(import.meta.url));
export const CLOUD_ROOT = path.resolve(here, "..");
export const REPO_ROOT = path.resolve(CLOUD_ROOT, "..");

export interface FunctionOptions {
  /** File under cloud/functions/handlers, without extension. */
  entry: string;
  handler?: string;
  description: string;
  environment?: Record<string, string>;
  memorySize?: number;
  timeout?: Duration;
  logRetentionDays: number;
  namespace: string;
  serviceName: string;
}

const RETENTION: Record<number, logs.RetentionDays> = {
  7: logs.RetentionDays.ONE_WEEK,
  14: logs.RetentionDays.TWO_WEEKS,
  30: logs.RetentionDays.ONE_MONTH,
  90: logs.RetentionDays.THREE_MONTHS,
};

/**
 * A TypeScript Lambda bundled with esbuild (ESM, arm64, Node 22): structured
 * JSON logs with a fixed retention, X-Ray tracing, and the AWS SDK bundled so
 * the deployed code matches the tested versions.
 */
export function makeFunction(scope: Construct, id: string, o: FunctionOptions): NodejsFunction {
  const logGroup = new logs.LogGroup(scope, `${id}Logs`, {
    retention: RETENTION[o.logRetentionDays] ?? logs.RetentionDays.TWO_WEEKS,
    removalPolicy: RemovalPolicy.DESTROY,
  });
  return new NodejsFunction(scope, id, {
    entry: path.join(CLOUD_ROOT, "functions", "handlers", `${o.entry}.ts`),
    handler: o.handler ?? "handler",
    // Bundled from cloud/ (where esbuild is installed); shared files in ../lib, ../data and ../types resolve by relative import.
    projectRoot: CLOUD_ROOT,
    depsLockFilePath: path.join(CLOUD_ROOT, "package-lock.json"),
    runtime: lambda.Runtime.NODEJS_22_X,
    architecture: lambda.Architecture.ARM_64,
    memorySize: o.memorySize ?? 512,
    timeout: o.timeout ?? Duration.seconds(10),
    description: o.description,
    tracing: lambda.Tracing.ACTIVE,
    logGroup,
    loggingFormat: lambda.LoggingFormat.JSON,
    environment: {
      NODE_OPTIONS: "--enable-source-maps",
      METRIC_NAMESPACE: o.namespace,
      SERVICE_NAME: o.serviceName,
      ...o.environment,
    },
    bundling: {
      format: OutputFormat.ESM,
      target: "node22",
      minify: true,
      sourceMap: true,
      externalModules: [],
      // ESM bundles still meet CommonJS dependencies inside the AWS SDK.
      banner: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
    },
  });
}
