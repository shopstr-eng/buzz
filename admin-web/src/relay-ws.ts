/**
 * Minimal relay WebSocket client for the admin panel.
 * Handles NIP-42 auth, subscriptions, and event publishing.
 *
 * REQ messages are buffered until NIP-42 auth completes so the relay never
 * receives a subscription before the connection is authenticated.  The relay
 * closes any REQ that arrives before auth with "auth-required"; without
 * buffering those subscriptions are silently dead and channels never load.
 */

import { hasStoredNsec, signEventObject } from "./identity";

const KIND_AUTH = 22242;

export type NostrEvent = Record<string, unknown> & {
  kind: number;
  tags: string[][];
  content: string;
  created_at: number;
};

type EventTemplate = {
  kind: number;
  tags: string[][];
  content: string;
  created_at?: number;
};

/** Sign with window.nostr (NIP-07) or stored nsec, whichever is available. */
async function sign(template: EventTemplate): Promise<NostrEvent> {
  const t = {
    ...template,
    created_at: template.created_at ?? Math.floor(Date.now() / 1000),
  };
  if (typeof window !== "undefined" && window.nostr) {
    return window.nostr.signEvent(t) as Promise<NostrEvent>;
  }
  if (hasStoredNsec()) {
    return signEventObject(t) as NostrEvent;
  }
  throw new Error("No signing key available.");
}

type SubCallbacks = {
  onEvent: (ev: NostrEvent) => void;
  onEose: () => void;
};

export class AdminRelayWs {
  private ws: WebSocket;
  private subs = new Map<string, SubCallbacks>();
  private counter = 0;

  /**
   * Messages queued before the WebSocket is open (any type).
   * Flushed in `onopen`.
   */
  private sendQueue: string[] = [];

  /**
   * REQ messages held back until NIP-42 auth completes.
   * The relay closes any REQ that arrives before auth with "auth-required",
   * so we must not send subscriptions until we have authenticated.
   */
  private reqQueue: string[] = [];

  /** True once we have sent an AUTH response. */
  private authed = false;

  private closed = false;

  constructor(
    private readonly url: string,
    private readonly onReady: () => void,
    private readonly onFatalError: (msg: string) => void,
  ) {
    this.ws = this.connect();
  }

  private connect(): WebSocket {
    const ws = new WebSocket(this.url);

    ws.onopen = () => {
      // Flush non-REQ messages queued before the socket opened.
      // REQ messages stay in reqQueue until after auth.
      for (const m of this.sendQueue) ws.send(m);
      this.sendQueue = [];
    };

    ws.onmessage = async (e: MessageEvent) => {
      let msg: unknown[];
      try {
        msg = JSON.parse(e.data as string) as unknown[];
      } catch {
        return;
      }

      const [type, ...rest] = msg;

      if (type === "AUTH" && typeof rest[0] === "string") {
        // NIP-42: relay requests auth — respond, then flush buffered REQs.
        const challenge = rest[0];
        try {
          const authEvent = await sign({
            kind: KIND_AUTH,
            tags: [
              ["challenge", challenge],
              ["relay", this.url],
            ],
            content: "",
          });
          this.rawSend(["AUTH", authEvent]);

          // Mark as authenticated and flush all buffered REQ messages.
          this.authed = true;
          for (const m of this.reqQueue) {
            if (this.ws.readyState === WebSocket.OPEN) {
              this.ws.send(m);
            }
          }
          this.reqQueue = [];

          this.onReady();
        } catch {
          this.onFatalError("Could not sign the NIP-42 auth challenge.");
        }
        return;
      }

      if (type === "EVENT" && typeof rest[0] === "string") {
        const subId = rest[0] as string;
        const ev = rest[1] as NostrEvent;
        this.subs.get(subId)?.onEvent(ev);
        return;
      }

      if (type === "EOSE" && typeof rest[0] === "string") {
        this.subs.get(rest[0] as string)?.onEose();
        return;
      }

      if (type === "CLOSED" && typeof rest[0] === "string") {
        // Relay closed the subscription — remove it so we don't leak the entry.
        // After the auth fix above, "auth-required" closes should no longer occur,
        // but handle them defensively.
        const subId = rest[0] as string;
        this.subs.delete(subId);
        return;
      }

      // NOTICE — ignore.
    };

    ws.onclose = () => {
      if (!this.closed) this.onFatalError("WebSocket closed unexpectedly.");
    };

    ws.onerror = () => {
      this.onFatalError("WebSocket connection error.");
    };

    return ws;
  }

  private rawSend(msg: unknown[]) {
    const str = JSON.stringify(msg);
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(str);
    } else {
      this.sendQueue.push(str);
    }
  }

  subscribe(
    filters: Record<string, unknown>,
    onEvent: (ev: NostrEvent) => void,
    onEose: () => void,
  ): () => void {
    const subId = `adm-${++this.counter}`;
    this.subs.set(subId, { onEvent, onEose });

    const msg = JSON.stringify(["REQ", subId, filters]);
    if (this.authed && this.ws.readyState === WebSocket.OPEN) {
      // Already authenticated — send immediately.
      this.ws.send(msg);
    } else {
      // Buffer until auth completes (or socket opens).
      this.reqQueue.push(msg);
    }

    return () => {
      this.subs.delete(subId);
      // Only send CLOSE if auth completed; otherwise just drop from reqQueue.
      if (this.authed) {
        this.rawSend(["CLOSE", subId]);
      } else {
        this.reqQueue = this.reqQueue.filter(
          (m) => !m.includes(`"${subId}"`),
        );
      }
    };
  }

  async publish(template: EventTemplate): Promise<NostrEvent> {
    const event = await sign(template);
    this.rawSend(["EVENT", event]);
    return event;
  }

  close() {
    this.closed = true;
    this.ws.close();
  }
}

/** Derive the relay's WebSocket URL from the current page origin. */
export function relayWsUrlFromOrigin(): string {
  return location.origin.replace(/^https/, "wss").replace(/^http/, "ws");
}
