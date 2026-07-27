/**
 * Live presence (kind 20001), mirroring the desktop client.
 *
 * Events carry content = "online" | "away" | "offline", no tags. The desktop
 * derives status from OS idle detection; the web approximates it with tab
 * visibility (hidden → away) plus a 4-minute heartbeat.
 *
 * `usePresenceLifecycle` mounts the global subscription + own publishing —
 * call it ONCE (sidebar). `usePresenceMap` is a cheap reader for any row.
 */

import { useEffect, useState } from "react";
import { useRelay } from "@/shared/context/relay-context";
import { getSignFn } from "@/shared/lib/identity";
import type { NostrEvent } from "@/shared/lib/relay-connection";

export const KIND_PRESENCE = 20001;
const HEARTBEAT_MS = 4 * 60 * 1000;

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
  return new Map([...presenceMap.entries()].map(([k, v]) => [k, v.status]));
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
    return unsub;
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
