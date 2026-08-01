/**
 * Edit and delete actions for chat messages, mirroring the desktop client:
 *   - Edit:   kind 40003, tags ["h", groupId] + ["e", targetId] + ["p", pk]
 *             for NEWLY-ADDED mentions only (desktop diff semantics: a
 *             typo-fix edit re-notifies nobody), content = new text.
 *             The latest edit per target wins (relay + desktop behavior).
 *             Desktop also re-emits imeta/emoji overlay sets; the web send
 *             path emits neither, so edits carry none and receivers preserve
 *             the original overlays (desktop applyEditTagOverlay semantics).
 *   - Delete: kind 5 (NIP-09), tags ["h", groupId] + ["e", targetId] — the same
 *             shape the desktop publishes for self-deletes (kind 9005 is the
 *             group-scoped moderation variant; the relay accepts both).
 *
 * Both publish via publishAndWait so relay rejections (permissions,
 * validation) surface as errors; the local update is applied only after the
 * relay accepts the event.
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
  editMessage: (messageId: string, content: string, newMentionPubkeys?: string[]) => Promise<void>;
  deleteMessage: (messageId: string) => Promise<void>;
  error: string | null;
} {
  const { connection, identity } = useRelay();
  const [error, setError] = useState<string | null>(null);

  const editMessage = useCallback(
    async (messageId: string, content: string, newMentionPubkeys?: string[]) => {
      if (!connection || !identity || !groupId) return;
      const trimmed = content.trim();
      if (!trimmed) return;

      const signFn = getSignFn();
      if (!signFn) {
        setError("No signing key available. Please log in again.");
        return;
      }

      const tags: string[][] = [
        ["h", groupId],
        ["e", messageId],
      ];
      for (const pk of newMentionPubkeys ?? []) {
        if (pk !== identity.pubkey && /^[0-9a-f]{64}$/i.test(pk)) tags.push(["p", pk]);
      }

      setError(null);
      try {
        const signed = await signFn({
          kind: KIND_STREAM_MSG_EDIT,
          created_at: Math.floor(Date.now() / 1000),
          tags,
          content: trimmed,
        });
        // publishAndWait surfaces relay rejections (permissions, validation);
        // only apply the optimistic local edit once the relay accepted it.
        await connection.publishAndWait(signed);
        applyLocalEdit(messageId, trimmed);
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
        // publishAndWait surfaces relay rejections; only remove locally once
        // the relay accepted the deletion.
        await connection.publishAndWait(signed);
        applyLocalDelete(messageId);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to delete message.");
      }
    },
    [connection, identity, groupId, applyLocalDelete],
  );

  return { editMessage, deleteMessage, error };
}
