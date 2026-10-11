// AppSync Events handlers for the `aeroscope` namespace (APPSYNC_JS runtime).
//
// Subscribers authenticate with a Cognito ID token and may subscribe only to
// their own channel, /aeroscope/users/<sub> — exact path, no wildcards. Only the
// backend publishes (IAM); the namespace refuses publishes from Cognito users.
import { util } from "@aws-appsync/utils";

export function onSubscribe(ctx) {
  const segments = ctx.info.channel.segments;
  const sub = ctx.identity && ctx.identity.sub;
  const own = sub && segments.length === 3 && segments[0] === "aeroscope" && segments[1] === "users" && segments[2] === sub;
  if (!own) {
    util.unauthorized();
  }
}

export function onPublish(ctx) {
  return ctx.events;
}
