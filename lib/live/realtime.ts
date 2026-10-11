/**
 * Real-time subscription to the signed-in user's channel.
 *
 * AWS: AppSync Events WebSocket (`aws-appsync-event-ws` protocol) authorised
 * with the Cognito ID token; the backend only lets you subscribe to
 * /aeroscope/users/<your sub>. Dev server: Server-Sent Events.
 *
 * Reconnects with jittered exponential backoff and a fresh token. While
 * disconnected the dashboard falls back to HTTP polling, so nothing is missed
 * for long — real-time only makes it instant.
 */
import type { EventEnvelope } from "@/types/api";

export type RealtimeStatus = "connecting" | "live" | "reconnecting" | "closed";

export interface RealtimeOptions {
  getIdToken: () => Promise<string | null>;
  onEvent: (e: EventEnvelope) => void;
  onStatus: (s: RealtimeStatus, detail?: string) => void;
}

export interface RealtimeConnection {
  close(): void;
}

const b64url = (s: string) => btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function backoff(attempt: number) {
  const base = Math.min(30_000, 1000 * 2 ** attempt);
  return base / 2 + Math.random() * (base / 2);
}

export function connectAppSync(httpDomain: string, realtimeDomain: string, channel: string, o: RealtimeOptions): RealtimeConnection {
  let ws: WebSocket | null = null;
  let closed = false;
  let attempt = 0;
  let kaTimer: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let timeoutMs = 300_000;

  const resetKeepAlive = () => {
    if (kaTimer) clearTimeout(kaTimer);
    kaTimer = setTimeout(() => ws?.close(), timeoutMs);
  };

  const scheduleReconnect = (detail?: string) => {
    if (closed) return;
    o.onStatus("reconnecting", detail);
    retryTimer = setTimeout(open, backoff(attempt++));
  };

  async function open() {
    if (closed) return;
    const token = await o.getIdToken();
    if (!token) {
      o.onStatus("closed", "Not signed in");
      return;
    }
    o.onStatus(attempt === 0 ? "connecting" : "reconnecting");
    const header = b64url(JSON.stringify({ host: httpDomain, Authorization: token }));
    const socket = new WebSocket(`wss://${realtimeDomain}/event/realtime`, ["aws-appsync-event-ws", `header-${header}`]);
    ws = socket;
    socket.onopen = () => socket.send(JSON.stringify({ type: "connection_init" }));
    socket.onmessage = (msg) => {
      let m: { type?: string; id?: string; event?: unknown; connectionTimeoutMs?: number; errors?: { message?: string }[] };
      try {
        m = JSON.parse(String(msg.data));
      } catch {
        return;
      }
      switch (m.type) {
        case "connection_ack":
          timeoutMs = m.connectionTimeoutMs ?? timeoutMs;
          resetKeepAlive();
          socket.send(JSON.stringify({ type: "subscribe", id: "user-channel", channel, authorization: { Authorization: token, host: httpDomain } }));
          break;
        case "ka":
          resetKeepAlive();
          break;
        case "subscribe_success":
          attempt = 0;
          o.onStatus("live");
          break;
        case "subscribe_error":
        case "connection_error":
          o.onStatus("reconnecting", m.errors?.[0]?.message ?? "Subscription refused");
          socket.close();
          break;
        case "data": {
          const raw = Array.isArray(m.event) ? m.event : [m.event];
          for (const item of raw) {
            try {
              const parsed = typeof item === "string" ? JSON.parse(item) : item;
              if (parsed && typeof parsed === "object" && "eventId" in parsed) o.onEvent(parsed as EventEnvelope);
            } catch {
              /* ignore malformed events */
            }
          }
          break;
        }
      }
    };
    socket.onclose = () => {
      if (kaTimer) clearTimeout(kaTimer);
      if (ws === socket) scheduleReconnect();
    };
    socket.onerror = () => socket.close();
  }

  void open();
  return {
    close() {
      closed = true;
      if (kaTimer) clearTimeout(kaTimer);
      if (retryTimer) clearTimeout(retryTimer);
      ws?.close();
      o.onStatus("closed");
    },
  };
}

export function connectDevStream(apiUrl: string, o: RealtimeOptions): RealtimeConnection {
  let source: EventSource | null = null;
  let closed = false;
  void o.getIdToken().then((token) => {
    if (closed || !token) return;
    o.onStatus("connecting");
    source = new EventSource(`${apiUrl}/v1/dev/stream?token=${encodeURIComponent(token)}`);
    source.onopen = () => o.onStatus("live");
    source.onerror = () => o.onStatus("reconnecting", "Dev stream interrupted");
    source.onmessage = (m) => {
      try {
        o.onEvent(JSON.parse(m.data) as EventEnvelope);
      } catch {
        /* ignore */
      }
    };
  });
  return {
    close() {
      closed = true;
      source?.close();
      o.onStatus("closed");
    },
  };
}
