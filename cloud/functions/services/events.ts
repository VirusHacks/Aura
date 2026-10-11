/**
 * Domain events. API functions put them on the `aeroscope-<stage>` EventBridge
 * bus after the state change is saved; rules route them to the real-time
 * publisher and the notifier. DynamoDB stays the source of truth: a failed
 * publish is logged and counted, never turned into a failed request, and
 * clients recover through an HTTP refresh.
 */
import { randomUUID } from "node:crypto";
import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";
import {
  DOMAIN_EVENTS,
  type DomainEventDetail,
  type DomainEventType,
  EVENT_SCHEMA_VERSION,
  type EventEnvelope,
  type RealtimeEventType,
} from "../../../types/api";
import { log, metric } from "../shared/log";

export const EVENT_SOURCE = "aeroscope.api";

export interface DomainEvent {
  detailType: DomainEventType;
  detail: DomainEventDetail;
}

export interface EventPublisher {
  publish(events: DomainEvent[]): Promise<void>;
}

const REALTIME_TYPE: Record<DomainEventType, RealtimeEventType> = {
  [DOMAIN_EVENTS.TripStarted]: "trip.started",
  [DOMAIN_EVENTS.TripLocationUpdated]: "trip.location.updated",
  [DOMAIN_EVENTS.TripZoneChanged]: "trip.zone.changed",
  [DOMAIN_EVENTS.TripPaused]: "trip.paused",
  [DOMAIN_EVENTS.TripResumed]: "trip.resumed",
  [DOMAIN_EVENTS.TripEnded]: "trip.ended",
  [DOMAIN_EVENTS.AirQualityThresholdCrossed]: "airquality.updated",
  [DOMAIN_EVENTS.AlertCreated]: "alert.created",
  [DOMAIN_EVENTS.AlertUpdated]: "alert.updated",
  [DOMAIN_EVENTS.RouteAlternativesGenerated]: "route.alternatives.generated",
  [DOMAIN_EVENTS.RouteSelected]: "route.selected",
};

export function domainEvent(
  detailType: DomainEventType,
  input: { userId: string; correlationId: string; tripId?: string | null; zoneId?: string | null; payload: Record<string, unknown>; now: Date; type?: RealtimeEventType },
): DomainEvent {
  const envelope: EventEnvelope = {
    eventId: randomUUID(),
    type: input.type ?? REALTIME_TYPE[detailType],
    schemaVersion: EVENT_SCHEMA_VERSION,
    occurredAt: input.now.toISOString(),
    ...(input.tripId ? { tripId: input.tripId } : {}),
    ...(input.zoneId ? { zoneId: input.zoneId } : {}),
    correlationId: input.correlationId,
    payload: input.payload,
  };
  return { detailType, detail: { userId: input.userId, envelope } };
}

export class EventBridgePublisher implements EventPublisher {
  constructor(
    private readonly busName: string,
    private readonly client = new EventBridgeClient({ maxAttempts: 3 }),
  ) {}

  async publish(events: DomainEvent[]): Promise<void> {
    for (let i = 0; i < events.length; i += 10) {
      const batch = events.slice(i, i + 10);
      try {
        const res = await this.client.send(
          new PutEventsCommand({
            Entries: batch.map((e) => ({
              EventBusName: this.busName,
              Source: EVENT_SOURCE,
              DetailType: e.detailType,
              Detail: JSON.stringify(e.detail),
            })),
          }),
        );
        if (res.FailedEntryCount) {
          metric("EventPublishFailures", res.FailedEntryCount);
          log.error("Some domain events were not accepted", {
            failed: res.FailedEntryCount,
            codes: res.Entries?.filter((e) => e.ErrorCode).map((e) => e.ErrorCode),
          });
        }
        metric("EventsPublished", batch.length - (res.FailedEntryCount ?? 0));
      } catch (err) {
        metric("EventPublishFailures", batch.length);
        log.error("PutEvents failed", { error: (err as Error).name, types: batch.map((e) => e.detailType) });
      }
    }
  }
}

/** Collects events in memory (tests) and optionally forwards them (dev server). */
export class MemoryEventPublisher implements EventPublisher {
  readonly events: DomainEvent[] = [];
  constructor(private readonly forward?: (e: DomainEvent) => void) {}
  async publish(events: DomainEvent[]) {
    this.events.push(...events);
    events.forEach((e) => this.forward?.(e));
  }
}
