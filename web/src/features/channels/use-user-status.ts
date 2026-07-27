/**
 * Custom user status (kind 30315, NIP-38), mirroring the desktop client.
 *
 * Addressable event with d-tag "general": content = status text,
 * ["emoji", emoji] tag for the status emoji. Live-only subscription (latest
 * per pubkey wins).
 *
 * `useUserStatusLifecycle` mounts the global subscription and returns the
 * publish helper — call ONCE (sidebar). `useUserStatusMap` is a cheap reader.
 */

import { useCallback, useEffect, useState } from "react";
import { useRelay } from "@/shared/context/relay-context";
import { getSignFn } from "@/shared/lib/identity";
import type { NostrEvent } from "@/shared/lib/relay-connection";

export const KIND_USER_STATUS = 30315;
const STATUS_D_TAG = "general";

export interface UserStatus {
  text: string;
  emoji: string;
}

let statusMap = new Map<string, UserStatus & { ts: number }>();
const listeners = new Set<() => void>();

function emit() {
  for (const fn of listeners) fn();
}

/** Reader: re-renders when anyone's status changes. */
export function useUserStatusMap(): Map<string, UserStatus> {
  const [, setTick] = useState(0);
  useEffect(() => {
    const fn = () => setTick((t) => t + 1);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);
  return new Map(
    [...statusMap.entries()].map(([k, v]) => [k, { text: v.text, emoji: v.emoji }]),
  );
}

/** Mount once: subscribes to all statuses; returns the publish helper. */
export function useUserStatusLifecycle(): {
  publishStatus: (text: string, emoji: string) => Promise<void>;
} {
  const { connection, connectionState } = useRelay();

  useEffect(() => {
    if (!connection || connectionState !== "ready") return;
    statusMap = new Map();

    const unsub = connection.subscribe(
      { kinds: [KIND_USER_STATUS], "#d": [STATUS_D_TAG], limit: 0 },
      (ev: NostrEvent) => {
        const existing = statusMap.get(ev.pubkey);
        if (existing && existing.ts >= ev.created_at) return;
        statusMap.set(ev.pubkey, {
          text: ev.content,
          emoji: ev.tags.find((t) => t[0] === "emoji")?.[1] ?? "",
          ts: ev.created_at,
        });
        emit();
      },
    );
    return unsub;
  }, [connection, connectionState]);

  const publishStatus = useCallback(
    async (text: string, emoji: string) => {
      if (!connection) return;
      const signFn = getSignFn();
      if (!signFn) return;
      const tags: string[][] = [["d", STATUS_D_TAG]];
      if (emoji) tags.push(["emoji", emoji]);
      const signed = await signFn({
        kind: KIND_USER_STATUS,
        created_at: Math.floor(Date.now() / 1000),
        tags,
        content: text,
      });
      connection.publish(signed);
    },
    [connection],
  );

  return { publishStatus };
}
