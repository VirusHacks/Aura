/**
 * Scenario snapshot persistence. Proxies to the AWS API (Lambda + DynamoDB)
 * when AEROSCOPE_AQ_API_URL is configured; otherwise reports that persistence
 * is not configured rather than pretending to save.
 */
const NOT_CONFIGURED = {
  error: "Scenario persistence is not configured. Deploy /infra and set AEROSCOPE_AQ_API_URL.",
};

function remote(path: string) {
  const base = process.env.AEROSCOPE_AQ_API_URL;
  return base ? `${base.replace(/\/$/, "")}${path}` : null;
}

function headers(): HeadersInit {
  const key = process.env.AEROSCOPE_AQ_API_KEY;
  return { "content-type": "application/json", ...(key ? { "x-api-key": key } : {}) };
}

export async function GET() {
  const url = remote("/scenarios");
  if (!url) return Response.json(NOT_CONFIGURED, { status: 501 });
  const res = await fetch(url, { headers: headers(), cache: "no-store", signal: AbortSignal.timeout(4000) });
  return new Response(res.body, { status: res.status, headers: { "content-type": "application/json" } });
}

export async function POST(request: Request) {
  const url = remote("/scenarios");
  if (!url) return Response.json(NOT_CONFIGURED, { status: 501 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Body must be JSON" }, { status: 400 });
  }
  const snapshot = body as { preset?: unknown; timeIndex?: unknown };
  if (typeof snapshot.preset !== "string" || typeof snapshot.timeIndex !== "number") {
    return Response.json({ error: "Expected { preset: string, timeIndex: number }" }, { status: 400 });
  }
  const res = await fetch(url, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ preset: snapshot.preset, timeIndex: snapshot.timeIndex }),
    signal: AbortSignal.timeout(4000),
  });
  return new Response(res.body, { status: res.status, headers: { "content-type": "application/json" } });
}
