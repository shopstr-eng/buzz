/**
 * Live presence (kind 20001), mirroring the desktop client.
 *
 * Events carry content = "online" | "away" | "offline", no tags. The desktop
 * derives status from OS idle detection; the web approximates it with tab
 * visibility (hidden → away) plus a 60-second heartbeat.
 *
 * Cadence mirrors the desktop (presence.ts): heartbeat every 60s and the
 * relay's authoritative TTL is 3× that (180s), so entries older than the TTL
 * render as offline even when no explicit "offline" event arrives.
 *
 * `usePresenceLifecycle` mounts the global subscription + own publishing —
 * call it ONCE (sidebar). `usePresenceMap` is a cheap reader for any row.
 */

import { useEffect, useState } from "react";
import { useRelay } from "@/shared/context/relay-context";
import { getSignFn } from "@/shared/lib/identity";
import type { NostrEvent } from "@/shared/lib/relay-connection";

export const KIND_PRESENCE = 20001;
const HEARTBEAT_MS = 60_000;
/** Relay-owned presence TTL (matches desktop PRESENCE_TTL_SECONDS): 3× heartbeat. */
const PRESENCE_TTL_SECONDS = 3 * (HEARTBEAT_MS / 1000);

export type PresenceStatus = "online" | "away" | "offline";

let presenceMap = new Map<string, { status: PresenceStatus; ts: number }>();
const listeners = new Set<() => void>();

function emit() {
  for (const fn of listeners) fn();
}

/** Reader: re-renders when anyone's presence changes. */
export function usePresenceMap(): Map<string, PresenceStatus> {
  const [, setTick] = useState(0);
  useEffect(() => {
    const fn = () => setTick((t) => t + 1);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);
  // TTL-aware read: a heartbeat older than the relay TTL has expired
  // server-side — render offline rather than a stale "online"/"away".
  const now = Math.floor(Date.now() / 1000);
  return new Map(
    [...presenceMap.entries()].map(([k, v]) => [
      k,
      v.status !== "offline" && now - v.ts > PRESENCE_TTL_SECONDS ? "offline" : v.status,
    ]),
  );
}

/** Mount once: subscribes to all presence and publishes the user's own. */
export function usePresenceLifecycle(): void {
  const { connection, connectionState, identity } = useRelay();
  const myPubkey = identity?.pubkey;

  // Global subscription (live only — presence is ephemeral).
  useEffect(() => {
    if (!connection || connectionState !== "ready") return;
    presenceMap = new Map();

    const unsub = connection.subscribe(
      { kinds: [KIND_PRESENCE], limit: 0 },
      (ev: NostrEvent) => {
        const status: PresenceStatus =
          ev.content === "away" || ev.content === "offline" ? ev.content : "online";
        const existing = presenceMap.get(ev.pubkey);
        if (existing && existing.ts >= ev.created_at) return;
        presenceMap.set(ev.pubkey, { status, ts: ev.created_at });
        emit();
      },
    );
    // Fixed-cadence re-render so TTL-expired entries flip to offline even
    // when no new presence events arrive (desktop backstop-poll equivalent).
    const sweep = setInterval(emit, 30_000);
    return () => {
      unsub();
      clearInterval(sweep);
    };
  }, [connection, connectionState]);

  // Own presence: online now, heartbeat while visible, away when tab hidden.
  useEffect(() => {
    if (!connection || connectionState !== "ready" || !myPubkey) return;

    const publish = (status: PresenceStatus) => {
      const signFn = getSignFn();
      if (!signFn) return;
      void signFn({
        kind: KIND_PRESENCE,
        created_at: Math.floor(Date.now() / 1000),
        tags: [],
        content: status,
      })
        .then((signed) => connection.publish(signed))
        .catch(() => {});
    };

    publish("online");
    const heartbeat = setInterval(() => {
      if (!document.hidden) publish("online");
    }, HEARTBEAT_MS);
    const onVisibility = () => publish(document.hidden ? "away" : "online");
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      clearInterval(heartbeat);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [connection, connectionState, myPubkey]);
}
