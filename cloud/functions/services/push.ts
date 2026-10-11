/**
 * APNs delivery through Amazon SNS mobile push. Works only once an SNS
 * platform application exists for the app's bundle id (see cloud/README.md,
 * "Push notifications"); without one, registrations are stored as
 * `push-not-configured` and alerts reach the watch by in-app polling.
 */
import {
  CreatePlatformEndpointCommand,
  PublishCommand,
  SetEndpointAttributesCommand,
  SNSClient,
} from "@aws-sdk/client-sns";
import type { PollutionAlert } from "../../../types/api";

export type PushResult = { ok: true; messageId: string } | { ok: false; disabled: boolean; reason: string };

export interface PushSender {
  /** Creates (or returns the existing) endpoint for a device token and makes sure it is enabled. */
  ensureEndpoint(platformApplicationArn: string, token: string, existingArn: string | null): Promise<string>;
  send(endpointArn: string, environment: "sandbox" | "production", alert: PollutionAlert): Promise<PushResult>;
}

/** Short, actionable text with the zone name only — never coordinates. */
export function apnsPayload(alert: PollutionAlert) {
  const title = alert.kind === "upcoming-zone" ? "Poor air ahead" : alert.kind === "escalation" ? "Air getting worse" : "Poor air here";
  return {
    aps: {
      alert: { title, body: `${alert.zoneName} · AQI ${alert.aqi}${alert.isDemo ? " · DEMO" : ""}` },
      sound: "default",
      category: "AQI_ALERT",
      "thread-id": "aqi",
    },
    aeroscopeAlert: { ...alert, userId: undefined },
  };
}

export class SnsPushSender implements PushSender {
  constructor(private readonly client = new SNSClient({ maxAttempts: 2 })) {}

  async ensureEndpoint(platformApplicationArn: string, token: string, existingArn: string | null): Promise<string> {
    if (existingArn) {
      await this.client.send(new SetEndpointAttributesCommand({ EndpointArn: existingArn, Attributes: { Token: token, Enabled: "true" } }));
      return existingArn;
    }
    const res = await this.client.send(new CreatePlatformEndpointCommand({ PlatformApplicationArn: platformApplicationArn, Token: token }));
    if (!res.EndpointArn) throw new Error("SNS returned no endpoint");
    await this.client.send(new SetEndpointAttributesCommand({ EndpointArn: res.EndpointArn, Attributes: { Enabled: "true" } }));
    return res.EndpointArn;
  }

  async send(endpointArn: string, environment: "sandbox" | "production", alert: PollutionAlert): Promise<PushResult> {
    const key = environment === "production" ? "APNS" : "APNS_SANDBOX";
    try {
      const res = await this.client.send(
        new PublishCommand({
          TargetArn: endpointArn,
          MessageStructure: "json",
          Message: JSON.stringify({ default: `${alert.zoneName} · AQI ${alert.aqi}`, [key]: JSON.stringify(apnsPayload(alert)) }),
          MessageAttributes: {
            "AWS.SNS.MOBILE.APNS.PUSH_TYPE": { DataType: "String", StringValue: "alert" },
            "AWS.SNS.MOBILE.APNS.PRIORITY": { DataType: "String", StringValue: "10" },
          },
        }),
      );
      return { ok: true, messageId: res.MessageId ?? "" };
    } catch (err) {
      const name = (err as { name?: string }).name ?? "Error";
      return { ok: false, disabled: name === "EndpointDisabledException" || name === "EndpointDisabled", reason: name };
    }
  }
}
