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
import {
  parseTimeoutRejection,
  type TimeoutRejection,
} from "../moderation/use-moderation";

export function useSendMessage(
  groupId: string | null,
  addOptimistic: (msg: ChatMessage) => void,
  removeOptimistic?: (messageId: string) => void,
): {
  send: (content: string, replyToId?: string, mentionPubkeys?: string[]) => Promise<void>;
  isSending: boolean;
  error: string | null;
  /** Set when the relay rejected a send because the user is timed out. */
  timeoutRejection: TimeoutRejection | null;
} {
  const { connection, identity } = useRelay();
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timeoutRejection, setTimeoutRejection] = useState<TimeoutRejection | null>(null);

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

        // Single publish: publishAndWait emits EVENT and resolves on the
        // relay's OK. Reactive timeout detection (mirrors desktop): the relay
        // refuses writes from timed-out members with "restricted: …".
        void connection.publishAndWait(signed).catch((err: unknown) => {
          // Roll back the optimistic row — rejected sends get no echo and
          // would otherwise linger as pending forever.
          removeOptimistic?.(signed.id);
          const msg = err instanceof Error ? err.message : String(err);
          const rejection = parseTimeoutRejection(msg);
          if (rejection) {
            setTimeoutRejection(rejection);
          } else {
            setError(msg);
          }
        });
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to send message.",
        );
      } finally {
        setIsSending(false);
      }
    },
    [connection, identity, groupId, addOptimistic, removeOptimistic],
  );

  return { send, isSending, error, timeoutRejection };
}
