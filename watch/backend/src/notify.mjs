// Outbound side effects: APNs pushes through Amazon SNS, real-time events for
// the web dashboard through AWS AppSync Events, and CloudWatch metrics via the
// Embedded Metric Format. Each is optional and reports whether it is
// configured; nothing pretends to deliver when it is not.
import { aqiCategory } from "./engine.mjs";

/** CloudWatch Embedded Metric Format: one log line becomes metrics in `Aeroscope/Watch`. */
export function metric(name, value = 1, dimensions = {}) {
  const dims = Object.keys(dimensions);
  console.log(JSON.stringify({
    _aws: {
      Timestamp: Date.now(),
      CloudWatchMetrics: [{ Namespace: "Aeroscope/Watch", Dimensions: [dims], Metrics: [{ Name: name, Unit: "Count" }] }],
    },
    ...dimensions,
    [name]: value,
  }));
}

export function apnsPayload(alert) {
  return {
    aps: {
      alert: { title: alertTitle(alert), body: `${alert.zoneName} · AQI ${alert.aqi}` },
      sound: "default",
      category: "AQI_ALERT",
      "thread-id": "aqi",
    },
    // Decoded by the watch (UserNotificationsBridge.alertPayloadKey).
    aeroscopeAlert: alert,
  };
}

function alertTitle(alert) {
  const category = aqiCategory(alert.aqi);
  if (alert.kind === "upcoming-zone") return `${category} air ahead`;
  if (alert.kind === "escalation") return "Air got worse";
  return `${category} air here`;
}

export class SnsPush {
  /** @param {{ sandboxArn?: string, productionArn?: string }} arns SNS platform application ARNs (APNS_SANDBOX / APNS). */
  constructor(arns) {
    this.arns = arns;
  }
  get configured() {
    return Boolean(this.arns.sandboxArn || this.arns.productionArn);
  }
  async client() {
    if (!this.sns) {
      const mod = await import("@aws-sdk/client-sns");
      this.mod = mod;
      this.sns = new mod.SNSClient({});
    }
    return this.sns;
  }
  async registerDevice(userId, device) {
    const arn = device.environment === "production" ? this.arns.productionArn : this.arns.sandboxArn;
    if (!arn) return { ...device, endpointArn: null };
    const sns = await this.client();
    const res = await sns.send(new this.mod.CreatePlatformEndpointCommand({
      PlatformApplicationArn: arn,
      Token: device.token,
      CustomUserData: userId,
    }));
    // Re-enable endpoints SNS disabled after a token change.
    await sns.send(new this.mod.SetEndpointAttributesCommand({
      EndpointArn: res.EndpointArn,
      Attributes: { Token: device.token, Enabled: "true" },
    }));
    return { ...device, endpointArn: res.EndpointArn };
  }
  async send(devices, alert) {
    if (!this.configured) return 0;
    const sns = await this.client();
    const body = JSON.stringify(apnsPayload(alert));
    let sent = 0;
    for (const device of devices.filter((d) => d.endpointArn)) {
      try {
        await sns.send(new this.mod.PublishCommand({
          TargetArn: device.endpointArn,
          MessageStructure: "json",
          Message: JSON.stringify({ default: `${alert.zoneName} AQI ${alert.aqi}`, APNS: body, APNS_SANDBOX: body }),
          MessageAttributes: {
            // watchOS requires an explicit push type.
            "AWS.SNS.MOBILE.APNS.PUSH_TYPE": { DataType: "String", StringValue: "alert" },
            "AWS.SNS.MOBILE.APNS.PRIORITY": { DataType: "String", StringValue: "10" },
          },
        }));
        sent += 1;
      } catch (err) {
        metric("PushFailures");
        console.error("push failed", device.deviceId, err?.name ?? err);
      }
    }
    if (sent) metric("PushesSent", sent);
    return sent;
  }
}

export const NoPush = {
  configured: false,
  async registerDevice(_userId, device) {
    return { ...device, endpointArn: null };
  },
  async send() {
    return 0;
  },
};

/** Publishes to an AppSync Events API over HTTP: POST https://<http-domain>/event. */
export class AppSyncEvents {
  constructor({ httpDomain, apiKey, namespace = "aeroscope" }) {
    this.httpDomain = httpDomain;
    this.apiKey = apiKey;
    this.namespace = namespace;
  }
  get configured() {
    return Boolean(this.httpDomain && this.apiKey);
  }
  async publish(userId, event) {
    if (!this.configured) return false;
    const channels = [`/${this.namespace}/users/${userId}`];
    if (event.tripId) channels.push(`/${this.namespace}/trips/${event.tripId}`);
    try {
      for (const channel of channels) {
        const res = await fetch(`https://${this.httpDomain}/event`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-api-key": this.apiKey },
          body: JSON.stringify({ channel, events: [JSON.stringify(event)] }),
          signal: AbortSignal.timeout(2000),
        });
        if (!res.ok) throw new Error(`AppSync Events responded ${res.status}`);
      }
      return true;
    } catch (err) {
      metric("RealtimePublishFailures");
      console.error("realtime publish failed", err?.message ?? err);
      return false;
    }
  }
}

/** In-process fan-out for the dev server's Server-Sent Events stream. */
export class LocalEvents {
  constructor() {
    this.listeners = new Set();
  }
  get configured() {
    return true;
  }
  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  async publish(userId, event) {
    for (const fn of this.listeners) fn({ userId, ...event });
    return true;
  }
}

export const NoEvents = {
  configured: false,
  async publish() {
    return false;
  },
};
