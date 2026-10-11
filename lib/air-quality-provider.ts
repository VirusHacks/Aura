/**
 * Server-side data-provider abstraction. The 3D renderer and dashboard only
 * ever see a `ZoneDataset`; swapping the provider never touches them.
 *
 * - DemoProvider: the bundled deterministic dataset (default).
 * - RemoteProvider: an HTTP endpoint (e.g. the AWS API Gateway + Lambda stack
 *   in /infra) configured with AEROSCOPE_AQ_API_URL. Credentials stay on the
 *   server; nothing here is exposed to the browser.
 */
import { DEMO_DATASET } from "../data/demo-zones";
import type { ZoneDataset } from "../types/air-quality";
import { parseZoneDataset } from "./zone-schema";

export interface AirQualityProvider {
  readonly id: string;
  getZones(): Promise<ZoneDataset>;
}

export class DemoProvider implements AirQualityProvider {
  readonly id = "demo";
  async getZones(): Promise<ZoneDataset> {
    return DEMO_DATASET;
  }
}

export class RemoteProvider implements AirQualityProvider {
  readonly id = "remote";
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey?: string,
    private readonly timeoutMs = 4000,
  ) {}

  async getZones(): Promise<ZoneDataset> {
    const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/zones`, {
      headers: this.apiKey ? { "x-api-key": this.apiKey } : undefined,
      signal: AbortSignal.timeout(this.timeoutMs),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Remote provider responded ${res.status}`);
    return parseZoneDataset(await res.json());
  }
}

export interface ProviderResult {
  dataset: ZoneDataset;
  provider: string;
  /** Present when a configured remote provider failed and we fell back. */
  fallbackReason?: string;
}

export function remoteConfigured(): boolean {
  return Boolean(process.env.AEROSCOPE_AQ_API_URL);
}

export async function loadZoneDataset(): Promise<ProviderResult> {
  const url = process.env.AEROSCOPE_AQ_API_URL;
  if (!url) return { dataset: await new DemoProvider().getZones(), provider: "demo" };
  try {
    const dataset = await new RemoteProvider(url, process.env.AEROSCOPE_AQ_API_KEY).getZones();
    return { dataset, provider: "remote" };
  } catch (err) {
    return {
      dataset: await new DemoProvider().getZones(),
      provider: "demo",
      fallbackReason: err instanceof Error ? err.message : "Remote provider failed",
    };
  }
}
