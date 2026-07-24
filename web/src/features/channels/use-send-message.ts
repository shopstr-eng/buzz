/**
 * Hook for sending a kind-9 (NIP-29 stream) chat message to a group.
 * Adds an optimistic message immediately and publishes to the relay.
 *
 * mentionPubkeys — pubkeys typed via @mention picker; each becomes a ["p", pk] tag.
 */

import { useCallback, useState } from "react";
import { useRelay } from "@/shared/context/relay-context";
import { getSignFn } from "@/shared/lib/identity";
import { KIND_STREAM_MSG, type ChatMessage } from "./types";

export function useSendMessage(
  groupId: string | null,
  addOptimistic: (msg: ChatMessage) => void,
): {
  send: (content: string, replyToId?: string, mentionPubkeys?: string[]) => Promise<void>;
  isSending: boolean;
  error: string | null;
} {
  const { connection, identity } = useRelay();
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = useCallback(
    async (content: string, replyToId?: string, mentionPubkeys?: string[]) => {
      if (!connection || !identity || !groupId) return;
      const trimmed = content.trim();
      if (!trimmed) return;

      const signFn = getSignFn();
      if (!signFn) {
        setError("No signing key available. Please log in again.");
        return;
      }

      setIsSending(true);
      setError(null);

      const now = Math.floor(Date.now() / 1000);
      const tags: string[][] = [["h", groupId]];
      if (replyToId) tags.push(["e", replyToId, "", "reply"]);
      for (const pk of mentionPubkeys ?? []) {
        tags.push(["p", pk]);
      }

      try {
        const unsigned = {
          kind: KIND_STREAM_MSG,
          created_at: now,
          tags,
          content: trimmed,
        };
        const signed = await signFn(unsigned);

        // Optimistic update — shown immediately, replaced by server echo.
        addOptimistic({
          id: signed.id,
          pubkey: signed.pubkey,
          content: trimmed,
          createdAt: now,
          kind: KIND_STREAM_MSG,
          replyToId,
          isPending: true,
        });

        connection.publish(signed);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to send message.",
        );
      } finally {
        setIsSending(false);
      }
    },
    [connection, identity, groupId, addOptimistic],
  );

  return { send, isSending, error };
}
