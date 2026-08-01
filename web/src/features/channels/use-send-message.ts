/**
 * Hook for sending a kind-9 (NIP-29 stream) chat message to a group.
 * Adds an optimistic message immediately and publishes to the relay.
 *
 * mentionPubkeys — pubkeys typed via @mention picker; each becomes a ["p", pk] tag.
 */

import { useCallback, useEffect, useState } from "react";
import { useRelay } from "@/shared/context/relay-context";
import { getSignFn } from "@/shared/lib/identity";
import { KIND_STREAM_MSG, type ChatMessage } from "./types";
import {
  parseTimeoutRejection,
  type TimeoutRejection,
} from "../moderation/use-moderation";

/** Which composer initiated a send — used to show a rejection only next to it. */
export type SendOrigin = "main" | "thread";

/** A send rejection tagged with the composer that triggered it. */
export interface SendError {
  origin: SendOrigin;
  message: string;
}

/** A timeout rejection tagged with the composer that triggered it. */
export interface OriginTimeoutRejection extends TimeoutRejection {
  origin: SendOrigin;
}

export function useSendMessage(
  groupId: string | null,
  addOptimistic: (msg: ChatMessage) => void,
  removeOptimistic?: (messageId: string) => void,
): {
  send: (
    content: string,
    replyToId?: string,
    mentionPubkeys?: string[],
    origin?: SendOrigin,
  ) => Promise<void>;
  isSending: boolean;
  error: SendError | null;
  /**
   * Clears a previous send rejection (e.g. when the user starts typing again).
   * When an origin is given, only clears an error from that composer.
   */
  clearError: (origin?: SendOrigin) => void;
  /** Set when the relay rejected a send because the user is timed out, tagged with the composer that sent. */
  timeoutRejection: OriginTimeoutRejection | null;
} {
  const { connection, identity } = useRelay();
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<SendError | null>(null);
  const [timeoutRejection, setTimeoutRejection] = useState<OriginTimeoutRejection | null>(null);

  // Auto-dismiss the timeout notice once the expiry time passes, so users
  // aren't misled into thinking they're still blocked.
  useEffect(() => {
    if (!timeoutRejection?.expiresAtMs) return;
    const remaining = timeoutRejection.expiresAtMs - Date.now();
    if (remaining <= 0) {
      setTimeoutRejection(null);
      return;
    }
    const timer = setTimeout(() => setTimeoutRejection(null), remaining);
    return () => clearTimeout(timer);
  }, [timeoutRejection]);

  const send = useCallback(
    async (
      content: string,
      replyToId?: string,
      mentionPubkeys?: string[],
      origin: SendOrigin = "main",
    ) => {
      if (!connection || !identity || !groupId) return;
      const trimmed = content.trim();
      if (!trimmed) return;

      const signFn = getSignFn();
      if (!signFn) {
        setError({ origin, message: "No signing key available. Please log in again." });
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
        void connection
          .publishAndWait(signed)
          .then(() => {
            // A fresh successful send proves the timeout is over — clear any
            // stale notice (e.g. no-expiry timeouts lifted by a moderator).
            setTimeoutRejection(null);
          })
          .catch((err: unknown) => {
            // Roll back the optimistic row — rejected sends get no echo and
            // would otherwise linger as pending forever.
            removeOptimistic?.(signed.id);
            const msg = err instanceof Error ? err.message : String(err);
            const rejection = parseTimeoutRejection(msg);
            if (rejection) {
              setTimeoutRejection({ ...rejection, origin });
            } else {
              setError({ origin, message: msg });
            }
          });
      } catch (err) {
        setError({
          origin,
          message: err instanceof Error ? err.message : "Failed to send message.",
        });
      } finally {
        setIsSending(false);
      }
    },
    [connection, identity, groupId, addOptimistic, removeOptimistic],
  );

  const clearError = useCallback(
    (origin?: SendOrigin) =>
      setError((prev) => (prev && origin && prev.origin !== origin ? prev : null)),
    [],
  );

  return { send, isSending, error, clearError, timeoutRejection };
}
