import { loadZoneDataset, remoteConfigured } from "@/lib/air-quality-provider";

/**
 * Zone baseline dataset. With no AEROSCOPE_AQ_API_URL configured this returns
 * the bundled demo dataset (and is prerendered at build time); with a remote
 * provider configured it runs per request and falls back to demo on failure.
 */
export async function GET() {
  if (!remoteConfigured()) {
    const { dataset, provider } = await loadZoneDataset();
    return Response.json({ ...dataset, provider });
  }
  const { dataset, provider, fallbackReason } = await loadZoneDataset();
  return Response.json(
    { ...dataset, provider, fallbackReason },
    { headers: { "Cache-Control": "no-store" } },
  );
}
