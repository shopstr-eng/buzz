/**
 * Minimal relay WebSocket client for the admin panel.
 * Handles NIP-42 auth, subscriptions, and event publishing.
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
  /** Messages waiting to be sent once the socket is open. */
  private sendQueue: string[] = [];
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
      // Flush any messages queued before the socket opened.
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
        // NIP-42: relay requests auth — respond.
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

      // CLOSED — if auth-required, we already handle AUTH above.
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
    this.rawSend(["REQ", subId, filters]);
    return () => {
      this.subs.delete(subId);
      this.rawSend(["CLOSE", subId]);
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
