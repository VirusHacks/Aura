#!/usr/bin/env node
// Local AEROSCOPE watch API for simulator and demo testing — the same app
// code as the Lambda, with an in-memory store. Not for production.
//
//   node dev-server.mjs                 # http://localhost:8787
//   PORT=9000 AEROSCOPE_API_KEY=secret AEROSCOPE_OPERATOR_KEY=op-secret node dev-server.mjs
//
// Extra local-only route: GET /v1/stream — Server-Sent Events carrying the
// same events the Lambda publishes to AppSync Events (curl -N to watch them).
import { createServer } from "node:http";
import { createApp } from "./src/app.mjs";
import { LocalEvents, NoPush } from "./src/notify.mjs";
import { MemoryStore } from "./src/store.mjs";

const port = Number(process.env.PORT ?? 8787);
const apiKey = process.env.AEROSCOPE_API_KEY || null;
const events = new LocalEvents();
// Locally, operator routes are open unless AEROSCOPE_OPERATOR_KEY is set.
const app = createApp({
  store: new MemoryStore(),
  push: NoPush,
  events,
  version: "dev",
  operatorKey: process.env.AEROSCOPE_OPERATOR_KEY || null,
  allowOperatorWithoutKey: true,
});

function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body ?? {}));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const started = Date.now();

  if (apiKey && req.headers["x-api-key"] !== apiKey) return send(res, 403, { error: "Forbidden" });

  if (req.method === "GET" && url.pathname === "/v1/stream") {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    res.write(": connected\n\n");
    const unsubscribe = events.subscribe((event) => res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));
    const heartbeat = setInterval(() => res.write(": ping\n\n"), 15000);
    req.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
    return;
  }

  let raw = "";
  for await (const chunk of req) raw += chunk;
  let body = null;
  if (raw) {
    try {
      body = JSON.parse(raw);
    } catch {
      return send(res, 400, { error: "Body must be JSON" });
    }
  }
  const { status, body: out } = await app.handle({
    method: req.method,
    path: url.pathname,
    query: Object.fromEntries(url.searchParams),
    headers: Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k.toLowerCase(), Array.isArray(v) ? v[0] : v])),
    body,
  });
  send(res, status, out);
  console.log(`${req.method} ${url.pathname} → ${status} (${Date.now() - started} ms)`);
});

server.listen(port, () => {
  console.log(`AEROSCOPE watch API (dev) on http://localhost:${port}${apiKey ? " — x-api-key required" : ""}`);
  console.log("Data: bundled DEMO baselines. Events: GET /v1/stream");
});
