/**
 * EventBridge `AeroScope.AlertCreated` → APNs through SNS.
 *
 * Idempotent per alert and device: a delivery record is written with a
 * conditional put before sending, so a redelivered event sends nothing twice.
 * Respects the user's alert preference, marks endpoints APNs has disabled as
 * invalid, and records every outcome. Emits no events, so it cannot loop.
 */
import type { EventBridgeEvent } from "aws-lambda";
import type { DomainEventDetail, PollutionAlert } from "../../../types/api";
import { DynamoAlertsRepo, DynamoUsersRepo } from "../repo/dynamo";
import type { AlertsRepo, UsersRepo } from "../repo/types";
import { log, metric } from "../shared/log";
import { type PushSender, SnsPushSender } from "../services/push";

export function makeNotifier(deps: { users: UsersRepo; alerts: AlertsRepo; push: PushSender | null }) {
  return async (event: EventBridgeEvent<string, DomainEventDetail<{ alert: PollutionAlert }>>) => {
    const { userId, envelope } = event.detail ?? ({} as DomainEventDetail<{ alert: PollutionAlert }>);
    const alert = envelope?.payload?.alert;
    if (!userId || !alert?.id) {
      log.warn("Ignoring malformed AlertCreated event");
      return { sent: 0 };
    }
    const logger = log.child({ correlationId: envelope.correlationId });
    const prefs = await deps.users.getPreferences(userId);
    const devices = await deps.users.listDevices(userId);
    let sent = 0;
    for (const device of devices) {
      if (prefs && prefs.alertsEnabled === false) {
        await deps.alerts.recordDelivery(userId, alert.id, device.deviceId, "skipped-preferences", null);
        continue;
      }
      if (!deps.push || device.tokenStatus !== "active" || !device.endpointArn) {
        if (await deps.alerts.recordDelivery(userId, alert.id, device.deviceId, "push-not-configured", device.tokenStatus)) metric("PushSkipped");
        continue;
      }
      // Claim the attempt first: a duplicate event stops here.
      if (!(await deps.alerts.recordDelivery(userId, alert.id, device.deviceId, "pending", null))) {
        metric("PushDuplicatesIgnored");
        continue;
      }
      metric("PushAttempts", 1, { Platform: device.platform });
      const result = await deps.push.send(device.endpointArn, device.environment, alert);
      await deps.alerts.updateDelivery(userId, alert.id, device.deviceId, result.ok ? "sent" : result.disabled ? "endpoint-disabled" : "failed", result.ok ? result.messageId : result.reason);
      if (result.ok) {
        sent++;
        metric("PushesSent", 1, { Platform: device.platform });
      } else {
        metric("PushFailures", 1, { Platform: device.platform, Reason: result.disabled ? "EndpointDisabled" : "Error" });
        logger.warn("Push failed", { platform: device.platform, reason: result.reason });
        if (result.disabled) await deps.users.putDevice({ ...device, tokenStatus: "invalid", updatedAt: new Date().toISOString() });
      }
    }
    return { sent };
  };
}

let notifier: ReturnType<typeof makeNotifier> | null = null;
export async function handler(event: EventBridgeEvent<string, DomainEventDetail<{ alert: PollutionAlert }>>) {
  const pushConfigured = Boolean(process.env.APNS_PLATFORM_ARN_SANDBOX || process.env.APNS_PLATFORM_ARN_PRODUCTION);
  notifier ??= makeNotifier({
    users: new DynamoUsersRepo(process.env.USERS_TABLE!),
    alerts: new DynamoAlertsRepo(process.env.ALERTS_TABLE!),
    push: pushConfigured ? new SnsPushSender() : null,
  });
  return notifier(event);
}
