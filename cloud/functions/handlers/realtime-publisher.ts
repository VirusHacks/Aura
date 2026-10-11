/**
 * EventBridge → AppSync Events. Forwards each domain event's envelope to its
 * owner's channel. A failure throws, so EventBridge retries (bounded) and then
 * parks the event in the dead-letter queue. Duplicate deliveries are harmless:
 * clients drop envelopes whose `eventId` they have seen.
 */
import type { EventBridgeEvent } from "aws-lambda";
import type { DomainEventDetail } from "../../../types/api";
import { log, metric } from "../shared/log";
import { AppSyncEventsPublisher, type RealtimePublisher } from "../services/realtime";

export function makeRealtimeHandler(publisher: RealtimePublisher) {
  return async (event: EventBridgeEvent<string, DomainEventDetail>) => {
    const { userId, envelope } = event.detail ?? ({} as DomainEventDetail);
    if (!userId || !envelope?.eventId) {
      log.warn("Ignoring malformed domain event", { detailType: event["detail-type"] });
      return;
    }
    try {
      await publisher.publish(userId, [envelope]);
      metric("RealtimePublished", 1, { Type: envelope.type });
    } catch (err) {
      metric("RealtimePublishFailures", 1, { Type: envelope.type });
      log.error("Real-time publish failed", { type: envelope.type, correlationId: envelope.correlationId, error: (err as Error).message });
      throw err;
    }
  };
}

let handlerImpl: ReturnType<typeof makeRealtimeHandler> | null = null;
export async function handler(event: EventBridgeEvent<string, DomainEventDetail>) {
  handlerImpl ??= makeRealtimeHandler(
    new AppSyncEventsPublisher(process.env.APPSYNC_HTTP_DOMAIN!, process.env.APPSYNC_NAMESPACE ?? "aeroscope", process.env.AWS_REGION ?? "us-east-1"),
  );
  return handlerImpl(event);
}
