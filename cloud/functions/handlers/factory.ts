/**
 * Builds an AppContext for a Lambda from its environment. A function only gets
 * the repositories whose table names are in its environment, matching the IAM
 * grants made in cloud/lib/app-stack.ts.
 */
import { AmazonLocationRoutingProvider } from "../domain/routing/amazon-location";
import { ZoneGraphRoutingProvider } from "../domain/routing/zone-graph";
import {
  DynamoAlertsRepo,
  DynamoCityRepo,
  DynamoIdempotencyRepo,
  DynamoPairingRepo,
  DynamoTripsRepo,
  DynamoUsersRepo,
} from "../repo/dynamo";
import { EventBridgePublisher, MemoryEventPublisher } from "../services/events";
import { SnsPushSender } from "../services/push";
import { type AppContext, configFromEnv, defaultIds } from "../app/context";


export function contextFromEnv(env: NodeJS.ProcessEnv = process.env): AppContext {
  const config = configFromEnv(env);
  const table = (name: string) => (env[name] && env[name]!.trim() ? env[name]!.trim() : null);
  const trips = table("TRIPS_TABLE");
  const alerts = table("ALERTS_TABLE");
  const users = table("USERS_TABLE");
  const idem = table("IDEMPOTENCY_TABLE");
  const pairing = table("PAIRING_TABLE");
  const bus = table("EVENT_BUS_NAME");
  const location = config.routing === "amazon-location" ? new AmazonLocationRoutingProvider() : null;
  return {
    config,
    city: new DynamoCityRepo(table("ZONES_TABLE"), table("SCENARIOS_TABLE"), env.BASELINE_PROVENANCE === "verified" ? "verified" : "demo"),
    trips: trips ? new DynamoTripsRepo(trips) : undefined,
    alerts: alerts ? new DynamoAlertsRepo(alerts) : undefined,
    users: users ? new DynamoUsersRepo(users) : undefined,
    idempotency: idem ? new DynamoIdempotencyRepo(idem) : undefined,
    pairing: pairing ? new DynamoPairingRepo(pairing) : undefined,
    events: bus ? new EventBridgePublisher(bus) : new MemoryEventPublisher(),
    routing: (city, aqi) => location ?? new ZoneGraphRoutingProvider(city, aqi),
    fallbackRouting: (city, aqi) => new ZoneGraphRoutingProvider(city, aqi),
    push: config.push.sandboxArn || config.push.productionArn ? new SnsPushSender() : undefined,
    ...defaultIds,
  };
}
