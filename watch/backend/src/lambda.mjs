// API Gateway (REST, Lambda proxy) entry point for the watch API.
import { createApp } from "./app.mjs";
import { AppSyncEvents, NoEvents, NoPush, SnsPush } from "./notify.mjs";
import { DynamoStore } from "./store.mjs";

const env = process.env;

const push = env.APNS_PLATFORM_ARN_SANDBOX || env.APNS_PLATFORM_ARN_PRODUCTION
  ? new SnsPush({ sandboxArn: env.APNS_PLATFORM_ARN_SANDBOX, productionArn: env.APNS_PLATFORM_ARN_PRODUCTION })
  : NoPush;

const events = env.APPSYNC_EVENTS_HTTP_DOMAIN && env.APPSYNC_EVENTS_API_KEY
  ? new AppSyncEvents({ httpDomain: env.APPSYNC_EVENTS_HTTP_DOMAIN, apiKey: env.APPSYNC_EVENTS_API_KEY, namespace: env.APPSYNC_EVENTS_NAMESPACE || "aeroscope" })
  : NoEvents;

const app = createApp({
  store: new DynamoStore({
    table: env.WATCH_TABLE,
    zonesTable: env.ZONES_TABLE || undefined,
    snapshotsTable: env.SCENARIOS_TABLE || undefined,
    provenance: env.BASELINE_PROVENANCE,
  }),
  push,
  events,
  version: env.API_VERSION || "1.0.0",
  // Operator routes (demo simulation, scenario pinning) stay disabled without a key.
  operatorKey: env.OPERATOR_KEY || null,
});

const lowerKeys = (o) => Object.fromEntries(Object.entries(o ?? {}).map(([k, v]) => [k.toLowerCase(), v]));

export async function handler(event) {
  let body = null;
  if (event.body) {
    try {
      body = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body);
    } catch {
      return respond(400, { error: "Body must be JSON" });
    }
  }
  // With a Cognito authorizer the user is the token subject, not a header.
  const authUserId = event.requestContext?.authorizer?.claims?.sub;
  const { status, body: responseBody } = await app.handle({
    method: event.httpMethod,
    // event.path includes the stage only for custom domains; resource paths start at /v1.
    path: event.path?.replace(/^\/[^/]+(?=\/v1\/)/, "") ?? "/",
    query: event.queryStringParameters ?? {},
    headers: lowerKeys(event.headers),
    body,
    authUserId,
  });
  return respond(status, responseBody);
}

function respond(statusCode, body) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      "access-control-allow-origin": env.ALLOWED_ORIGIN ?? "",
    },
    body: JSON.stringify(body ?? {}),
  };
}
