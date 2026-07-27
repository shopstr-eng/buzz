/**
 * Typing indicators (kind 20002), mirroring the desktop client:
 *   - Broadcast: throttled to at most once every 3s per channel; empty
 *     content, ["h", groupId] tags; fire-and-forget.
 *   - Receive: entries expire after 8s (pruned every 1s); a typer's entry is
 *     cleared when their message (kind 9/40002) arrives; own events ignored.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRelay } from "@/shared/context/relay-context";
import { getSignFn } from "@/shared/lib/identity";
import { KIND_STREAM_MSG, KIND_STREAM_MSG_V2 } from "./types";
import type { NostrEvent } from "@/shared/lib/relay-connection";

export const KIND_TYPING = 20002;

const SEND_INTERVAL_MS = 3_000;
const TTL_MS = 8_000;
const PRUNE_INTERVAL_MS = 1_000;

/** Publish typing indicators for the current user (throttled). */
export function useTypingBroadcast(groupId: string | null): () => void {
  const { connection } = useRelay();
  const lastSentRef = useRef(0);
  const lastChannelRef = useRef(groupId);

  return useCallback(() => {
    if (!connection || !groupId) return;

    if (lastChannelRef.current !== groupId) {
      lastChannelRef.current = groupId;
      lastSentRef.current = 0;
    }

    const now = Date.now();
    if (now - lastSentRef.current < SEND_INTERVAL_MS) return;
    lastSentRef.current = now;

    const signFn = getSignFn();
    if (!signFn) return;

    void signFn({
      kind: KIND_TYPING,
      created_at: Math.floor(Date.now() / 1000),
      tags: [["h", groupId]],
      content: "",
    })
      .then((signed) => connection.publish(signed))
      .catch(() => {});
  }, [connection, groupId]);
}

/** Subscribe to typing indicators for a channel. Returns typing pubkeys. */
export function useTypingIndicator(groupId: string | null): string[] {
  const { connection, connectionState, identity } = useRelay();
  const myPubkey = identity?.pubkey;
  const [typers, setTypers] = useState<Map<string, number>>(new Map());

  useEffect(() => {
    if (!connection || connectionState !== "ready" || !groupId) return;
    setTypers(new Map());

    const prune = setInterval(() => {
      const now = Date.now();
      setTypers((prev) => {
        let changed = false;
        const next = new Map(prev);
        for (const [pk, expiresAt] of next) {
          if (expiresAt <= now) {
            next.delete(pk);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, PRUNE_INTERVAL_MS);

    const typingUnsub = connection.subscribe(
      { kinds: [KIND_TYPING], "#h": [groupId], since: Math.floor(Date.now() / 1000) },
      (ev: NostrEvent) => {
        if (ev.pubkey === myPubkey) return;
        setTypers((prev) => {
          const next = new Map(prev);
          next.set(ev.pubkey, Date.now() + TTL_MS);
          return next;
        });
      },
    );

    // A new message from a typer clears their entry immediately.
    const msgUnsub = connection.subscribe(
      {
        kinds: [KIND_STREAM_MSG, KIND_STREAM_MSG_V2],
        "#h": [groupId],
        since: Math.floor(Date.now() / 1000),
      },
      (ev: NostrEvent) => {
        setTypers((prev) => {
          if (!prev.has(ev.pubkey)) return prev;
          const next = new Map(prev);
          next.delete(ev.pubkey);
          return next;
        });
      },
    );

    return () => {
      clearInterval(prune);
      typingUnsub();
      msgUnsub();
    };
  }, [connection, connectionState, groupId, myPubkey]);

  return [...typers.keys()];
}
