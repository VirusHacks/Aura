/**
 * Publishes event envelopes to AppSync Events over HTTPS, signed with the
 * Lambda's IAM role (SigV4, service "appsync"). Only IAM may publish; clients
 * subscribe with Cognito tokens to their own `/aeroscope/users/{sub}` channel.
 */
import { Sha256 } from "@aws-crypto/sha256-js";
import { defaultProvider } from "@aws-sdk/credential-provider-node";
import { HttpRequest } from "@smithy/protocol-http";
import { SignatureV4 } from "@smithy/signature-v4";
import type { EventEnvelope } from "../../../types/api";

/** AppSync Events channel segments: 1–50 letters, digits or dashes. */
const SEGMENT = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,48}[A-Za-z0-9])?$/;

export function userChannel(namespace: string, userId: string): string {
  if (!SEGMENT.test(userId)) throw new Error("User id is not a valid channel segment");
  return `/${namespace}/users/${userId}`;
}

export interface RealtimePublisher {
  publish(userId: string, envelopes: EventEnvelope[]): Promise<void>;
}

export class AppSyncEventsPublisher implements RealtimePublisher {
  private readonly signer: SignatureV4;

  constructor(
    private readonly httpDomain: string,
    private readonly namespace: string,
    region: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.signer = new SignatureV4({ credentials: defaultProvider(), region, service: "appsync", sha256: Sha256 });
  }

  async publish(userId: string, envelopes: EventEnvelope[]): Promise<void> {
    // AppSync accepts up to five events per publish.
    for (let i = 0; i < envelopes.length; i += 5) {
      const body = JSON.stringify({ channel: userChannel(this.namespace, userId), events: envelopes.slice(i, i + 5).map((e) => JSON.stringify(e)) });
      const request = new HttpRequest({
        method: "POST",
        protocol: "https:",
        hostname: this.httpDomain,
        path: "/event",
        headers: { host: this.httpDomain, "content-type": "application/json" },
        body,
      });
      const signed = await this.signer.sign(request);
      const res = await this.fetchImpl(`https://${this.httpDomain}/event`, {
        method: "POST",
        headers: signed.headers as Record<string, string>,
        body,
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`AppSync Events publish failed: HTTP ${res.status} ${text.slice(0, 200)}`);
      }
      const result = (await res.json().catch(() => ({}))) as { failed?: unknown[] };
      if (result.failed?.length) throw new Error(`AppSync Events rejected ${result.failed.length} event(s)`);
    }
  }
}
