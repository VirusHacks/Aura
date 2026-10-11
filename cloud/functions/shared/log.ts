/**
 * Structured JSON logs and CloudWatch Embedded Metric Format (EMF) metrics.
 * Logs carry the correlation id and never tokens, keys or precise coordinates.
 */

export const METRIC_NAMESPACE = process.env.METRIC_NAMESPACE ?? "AEROSCOPE/dev";

type Level = "debug" | "info" | "warn" | "error";
const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const MIN_LEVEL = LEVELS[(process.env.LOG_LEVEL as Level) ?? "info"] ?? LEVELS.info;

/** Keys whose values must never reach a log line. */
const REDACT = /token|secret|password|authorization|key|geo|lat|lon/i;

function scrub(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => scrub(v, depth + 1));
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, REDACT.test(k) ? "[redacted]" : scrub(v, depth + 1)]),
  );
}

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
  child(fields: Record<string, unknown>): Logger;
}

export function createLogger(base: Record<string, unknown> = {}): Logger {
  const write = (level: Level, message: string, fields?: Record<string, unknown>) => {
    if (LEVELS[level] < MIN_LEVEL) return;
    const line = JSON.stringify({ level, message, time: new Date().toISOString(), ...base, ...(scrub(fields) as object) });
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
  };
  return {
    debug: (m, f) => write("debug", m, f),
    info: (m, f) => write("info", m, f),
    warn: (m, f) => write("warn", m, f),
    error: (m, f) => write("error", m, f),
    child: (fields) => createLogger({ ...base, ...fields }),
  };
}

export const log = createLogger({ service: process.env.SERVICE_NAME ?? "aeroscope" });

/**
 * Emits one EMF metric line. Dimensions stay low-cardinality (function,
 * outcome, reason) — never user ids, trip ids or zone ids.
 */
export function metric(name: string, value = 1, dimensions: Record<string, string> = {}, unit = "Count"): void {
  if (process.env.METRICS_DISABLED === "1") return;
  const dims = { Service: process.env.SERVICE_NAME ?? "aeroscope", ...dimensions };
  console.log(
    JSON.stringify({
      _aws: {
        Timestamp: Date.now(),
        CloudWatchMetrics: [{ Namespace: METRIC_NAMESPACE, Dimensions: [Object.keys(dims)], Metrics: [{ Name: name, Unit: unit }] }],
      },
      ...dims,
      [name]: value,
    }),
  );
}
