/**
 * Persistent Nostr relay WebSocket connection.
 *
 * Maintains a single WebSocket to the relay, handles NIP-42 AUTH automatically,
 * queues outbound REQ messages until authenticated, and reconnects with
 * exponential backoff on disconnect.
 */

import { makeAuthEvent } from "nostr-tools/nip42";
import type { UnsignedNostrEvent, SignedNostrEvent } from "@/shared/lib/nostr-signer";

export type { UnsignedNostrEvent, SignedNostrEvent };

export interface NostrFilter {
  ids?: string[];
  authors?: string[];
  kinds?: number[];
  since?: number;
  until?: number;
  limit?: number;
  [tag: `#${string}`]: string[] | undefined;
}

export type NostrEvent = SignedNostrEvent;

export type ConnectionState =
  | "disconnected"
  | "connecting"
  | "authenticating"
  | "ready";

type SubCallbacks = {
  onEvent: (event: NostrEvent) => void;
  onEose?: () => void;
};

const MIN_RECONNECT_MS = 1_000;
const MAX_RECONNECT_MS = 30_000;

export class RelayConnection {
  private ws: WebSocket | null = null;
  private subs = new Map<string, SubCallbacks>();
  private subFilters = new Map<string, NostrFilter>();
  private pendingOut: string[] = [];
  private authenticated = false;
  private authEventId: string | null = null;
  private reconnectDelay = MIN_RECONNECT_MS;
  private stopped = false;
  private stateListeners = new Set<(s: ConnectionState) => void>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  public state: ConnectionState = "disconnected";

  constructor(
    public readonly url: string,
    private readonly sign: (
      t: UnsignedNostrEvent,
    ) => Promise<SignedNostrEvent>,
  ) {}

  // ── lifecycle ──────────────────────────────────────────────────────────

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
    this.setState("disconnected");
  }

  // ── state observation ──────────────────────────────────────────────────

  onStateChange(listener: (s: ConnectionState) => void): () => void {
    this.stateListeners.add(listener);
    listener(this.state);
    return () => this.stateListeners.delete(listener);
  }

  private setState(s: ConnectionState) {
    if (this.state === s) return;
    this.state = s;
    for (const l of this.stateListeners) l(s);
  }

  // ── public API ─────────────────────────────────────────────────────────

  /**
   * Open a live subscription. Returns an unsubscribe function.
   * The subscription survives reconnects — it is replayed after re-auth.
   */
  subscribe(
    filter: NostrFilter,
    onEvent: (e: NostrEvent) => void,
    onEose?: () => void,
  ): () => void {
    const subId = `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    this.subs.set(subId, { onEvent, onEose });
    this.subFilters.set(subId, filter);
    this.send(JSON.stringify(["REQ", subId, filter]));
    return () => this.unsubscribe(subId);
  }

  /** Publish a signed Nostr event. */
  publish(event: SignedNostrEvent): void {
    this.send(JSON.stringify(["EVENT", event]));
  }

  // ── internal ───────────────────────────────────────────────────────────

  private unsubscribe(subId: string): void {
    this.subs.delete(subId);
    this.subFilters.delete(subId);
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(["CLOSE", subId]));
    }
  }

  private send(msg: string): void {
    if (this.authenticated && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(msg);
    } else {
      this.pendingOut.push(msg);
    }
  }

  private flushPending(): void {
    const msgs = this.pendingOut.splice(0);
    for (const m of msgs) this.ws?.send(m);
  }

  private resubscribeAll(): void {
    for (const [subId, filter] of this.subFilters) {
      this.ws?.send(JSON.stringify(["REQ", subId, filter]));
    }
  }

  private connect(): void {
    if (this.stopped) return;
    this.authenticated = false;
    this.authEventId = null;
    this.setState("connecting");

    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.addEventListener("open", () => {
      this.reconnectDelay = MIN_RECONNECT_MS;
      this.setState("authenticating");
    });

    ws.addEventListener("message", (ev) => {
      void this.handleMessage(String(ev.data));
    });

    ws.addEventListener("close", () => {
      if (!this.stopped) {
        this.setState("disconnected");
        this.scheduleReconnect();
      }
    });

    ws.addEventListener("error", () => {
      ws.close();
    });
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, MAX_RECONNECT_MS);
      this.connect();
    }, this.reconnectDelay);
  }

  private async handleMessage(raw: string): Promise<void> {
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }
    if (!Array.isArray(data) || data.length === 0) return;
    const [type] = data;

    if (type === "AUTH" && typeof data[1] === "string") {
      const challenge = data[1] as string;
      try {
        // makeAuthEvent returns a partial event template
        const template = makeAuthEvent(this.url, challenge) as UnsignedNostrEvent;
        const signed = await this.sign(template);
        this.authEventId = signed.id;
        this.ws?.send(JSON.stringify(["AUTH", signed]));
      } catch (err) {
        console.error("[RelayConnection] AUTH signing failed:", err);
      }
      return;
    }

    if (type === "OK" && data[1] === this.authEventId) {
      if (data[2] === true) {
        this.authenticated = true;
        this.setState("ready");
        // Replay active subscriptions then flush queued sends
        this.resubscribeAll();
        this.flushPending();
      } else {
        console.error("[RelayConnection] AUTH rejected:", data[3]);
      }
      return;
    }

    if (type === "EVENT" && typeof data[1] === "string" && data[2]) {
      const subId = data[1] as string;
      this.subs.get(subId)?.onEvent(data[2] as NostrEvent);
      return;
    }

    if (type === "EOSE" && typeof data[1] === "string") {
      const subId = data[1] as string;
      this.subs.get(subId)?.onEose?.();
      return;
    }
  }
}
