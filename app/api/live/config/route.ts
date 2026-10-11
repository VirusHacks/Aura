import { connection } from "next/server";
import { liveConfig } from "@/lib/live/server";

/** Public live-mode configuration for the browser: endpoints and ids only, never secrets. */
export async function GET() {
  // Read the environment per request, not at build time: the deployed Lambda sets AEROSCOPE_API_URL.
  await connection();
  const { mode, apiUrl, client } = await liveConfig();
  return Response.json(
    {
      mode,
      apiUrl: mode === "off" ? null : apiUrl,
      region: client?.region ?? null,
      realtime: client?.realtime ?? null,
      routing: client?.routing ?? null,
      push: client?.push ?? false,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
