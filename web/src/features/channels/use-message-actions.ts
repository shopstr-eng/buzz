/**
 * Edit and delete actions for chat messages, mirroring the desktop client:
 *   - Edit:   kind 40003, tags ["h", groupId] + ["e", targetId], content = new text.
 *             The latest edit per target wins (relay + desktop behavior).
 *   - Delete: kind 5 (NIP-09), tags ["h", groupId] + ["e", targetId] — the same
 *             shape the desktop publishes for self-deletes (kind 9005 is the
 *             group-scoped moderation variant; the relay accepts both).
 *
 * Both apply an optimistic local update; the live subscription confirms.
 */

import { useCallback, useState } from "react";
import { useRelay } from "@/shared/context/relay-context";
import { getSignFn } from "@/shared/lib/identity";
import { KIND_DELETION, KIND_STREAM_MSG_EDIT } from "./types";

export function useMessageActions(
  groupId: string | null,
  applyLocalEdit: (messageId: string, content: string) => void,
  applyLocalDelete: (messageId: string) => void,
): {
  editMessage: (messageId: string, content: string) => Promise<void>;
  deleteMessage: (messageId: string) => Promise<void>;
  error: string | null;
} {
  const { connection, identity } = useRelay();
  const [error, setError] = useState<string | null>(null);

  const editMessage = useCallback(
    async (messageId: string, content: string) => {
      if (!connection || !identity || !groupId) return;
      const trimmed = content.trim();
      if (!trimmed) return;

      const signFn = getSignFn();
      if (!signFn) {
        setError("No signing key available. Please log in again.");
        return;
      }

      setError(null);
      try {
        const signed = await signFn({
          kind: KIND_STREAM_MSG_EDIT,
          created_at: Math.floor(Date.now() / 1000),
          tags: [
            ["h", groupId],
            ["e", messageId],
          ],
          content: trimmed,
        });
        applyLocalEdit(messageId, trimmed);
        connection.publish(signed);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to edit message.");
      }
    },
    [connection, identity, groupId, applyLocalEdit],
  );

  const deleteMessage = useCallback(
    async (messageId: string) => {
      if (!connection || !identity || !groupId) return;

      const signFn = getSignFn();
      if (!signFn) {
        setError("No signing key available. Please log in again.");
        return;
      }

      setError(null);
      try {
        const signed = await signFn({
          kind: KIND_DELETION,
          created_at: Math.floor(Date.now() / 1000),
          tags: [
            ["h", groupId],
            ["e", messageId],
          ],
          content: "",
        });
        applyLocalDelete(messageId);
        connection.publish(signed);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to delete message.");
      }
    },
    [connection, identity, groupId, applyLocalDelete],
  );

  return { editMessage, deleteMessage, error };
}
