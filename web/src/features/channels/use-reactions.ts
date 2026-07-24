/**
 * Subscribe to kind:7 reaction events for a channel and expose a publish helper.
 *
 * Reactions are grouped by the `e` tag (message ID) and emoji content.
 * The same pubkey reacting multiple times to the same message is deduplicated
 * (last emoji wins), consistent with how most clients handle reaction updates.
 */

import { useEffect, useState, useCallback } from "react";
import { useRelay } from "@/shared/context/relay-context";
import { getSignFn } from "@/shared/lib/identity";
import type { NostrEvent } from "@/shared/lib/relay-connection";

export const KIND_REACTION = 7;

/** emoji → {count, mine} for a single message */
export type EmojiReactions = Record<string, { count: number; mine: boolean }>;
/** messageId → per-emoji reaction summary */
export type ReactionsMap = Record<string, EmojiReactions>;

/** Quick-reaction palette shown on message hover. */
export const QUICK_EMOJIS = ["👍", "❤️", "😄", "🚀", "👀", "🎉"];

export function useReactions(
  groupId: string | null,
  myPubkey?: string,
): {
  reactions: ReactionsMap;
  addReaction: (messageId: string, emoji: string) => Promise<void>;
} {
  const { connection, connectionState } = useRelay();
  const [reactions, setReactions] = useState<ReactionsMap>({});

  useEffect(() => {
    if (!connection || connectionState !== "ready" || !groupId) return;
    setReactions({});

    // Track the last emoji each pubkey used per message so we can swap it out
    // when the same pubkey reacts again (reaction-update semantics).
    const perPubkey = new Map<string, { messageId: string; emoji: string }>();

    const unsub = connection.subscribe(
      { kinds: [KIND_REACTION], "#h": [groupId], limit: 2000 },
      (ev: NostrEvent) => {
        const messageId = ev.tags.find((t) => t[0] === "e")?.[1];
        if (!messageId) return;
        const emoji = ev.content || "👍";
        const key = `${ev.pubkey}:${messageId}`;
        const prev = perPubkey.get(key);

        setReactions((old) => {
          const next = structuredClone(old) as ReactionsMap;

          // Remove old reaction from same author on same message
          if (prev) {
            const bucket = next[prev.messageId]?.[prev.emoji];
            if (bucket) {
              if (bucket.count <= 1) {
                delete next[prev.messageId][prev.emoji];
              } else {
                next[prev.messageId][prev.emoji] = {
                  count: bucket.count - 1,
                  mine: bucket.mine && ev.pubkey !== myPubkey,
                };
              }
            }
          }

          // Add new reaction
          if (!next[messageId]) next[messageId] = {};
          const existing = next[messageId][emoji] ?? { count: 0, mine: false };
          next[messageId][emoji] = {
            count: existing.count + 1,
            mine: existing.mine || ev.pubkey === myPubkey,
          };

          return next;
        });

        perPubkey.set(key, { messageId, emoji });
      },
    );

    return unsub;
  }, [connection, connectionState, groupId, myPubkey]);

  const addReaction = useCallback(
    async (messageId: string, emoji: string) => {
      if (!connection || !groupId) return;
      const signFn = getSignFn();
      if (!signFn) return;
      const signed = await signFn({
        kind: KIND_REACTION,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ["e", messageId],
          ["h", groupId],
        ],
        content: emoji,
      });
      connection.publish(signed);
    },
    [connection, groupId],
  );

  return { reactions, addReaction };
}
