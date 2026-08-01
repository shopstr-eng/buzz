/**
 * Right-side thread drawer: shows a root message with all its replies and a
 * composer that posts into the thread (e-tag reply to the root).
 *
 * Replies are discovered by walking replyToId chains up to the root — mirrors
 * the desktop's thread reference resolution.
 */

import { useMemo, useState } from "react";
import { X } from "lucide-react";
import type { ChatMessage } from "../types";
import type { ReactionsMap } from "../use-reactions";
import type { CustomEmoji } from "../use-custom-emoji";
import type { ChannelMember } from "../use-channel-members";
import type { Profile } from "@/shared/hooks/use-profiles";
import { MessageRow } from "./MessageRow";
import { MessageComposer } from "./MessageComposer";

interface Props {
  root: ChatMessage;
  /** All channel messages (used to discover thread replies) */
  messages: ChatMessage[];
  myPubkey?: string;
  profiles: Map<string, Profile>;
  members?: ChannelMember[];
  reactions?: ReactionsMap;
  onAddReaction?: (messageId: string, emoji: string, emojiUrl?: string) => void;
  onEdit?: (message: ChatMessage) => void;
  onDelete?: (message: ChatMessage) => void;
  customEmoji?: CustomEmoji[];
  customEmojiUrls?: Map<string, string>;
  /** Matches useSendMessage's send: (content, replyToId, mentionPubkeys) */
  onSend: (content: string, replyToId?: string, mentionPubkeys?: string[]) => Promise<void>;
  /** Relay rejection of the last thread send (OK-false reason); main-composer rejections are not shown here. */
  sendError?: string | null;
  /** Clears a previous send rejection (e.g. when the user starts typing again). */
  onClearSendError?: () => void;
  /** Set when the relay rejected a thread reply because the user is timed out. */
  timeoutRejection?: { expiresAtMs: number | null } | null;
  onClose: () => void;
  /** Import a fetched .agent.json snapshot shared into the chat */
  onImportAgent?: (jsonText: string) => Promise<void>;
  onImportTeam?: (jsonText: string) => Promise<void>;
}

/** Collect root + all descendants by walking replyToId chains. */
function collectThread(root: ChatMessage, messages: ChatMessage[]): ChatMessage[] {
  const byId = new Map(messages.map((m) => [m.id, m]));
  const inThread = new Set<string>([root.id]);

  const belongs = (m: ChatMessage): boolean => {
    let cur: ChatMessage | undefined = m;
    const seen = new Set<string>();
    while (cur?.replyToId) {
      if (seen.has(cur.id)) return false; // cycle guard
      seen.add(cur.id);
      if (inThread.has(cur.replyToId)) return true;
      cur = byId.get(cur.replyToId);
    }
    return false;
  };

  const replies = messages.filter((m) => m.id !== root.id && belongs(m));
  return [root, ...replies];
}

export function ThreadPanel({
  root,
  messages,
  myPubkey,
  profiles,
  members,
  reactions,
  onAddReaction,
  onEdit,
  onDelete,
  customEmoji,
  customEmojiUrls,
  onSend,
  sendError,
  onClearSendError,
  timeoutRejection,
  onClose,
  onImportAgent,
  onImportTeam,
}: Props) {
  const threadMessages = useMemo(() => collectThread(root, messages), [root, messages]);
  const [sending, setSending] = useState(false);
  const replyCount = threadMessages.length - 1;

  async function handleThreadSend(content: string, mentionPubkeys?: string[]) {
    setSending(true);
    try {
      await onSend(content, root.id, mentionPubkeys);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex w-80 shrink-0 flex-col border-l border-black/10 bg-white dark:border-white/10 dark:bg-[#111111]">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-black/10 px-3 py-2.5 dark:border-white/10">
        <span className="text-sm font-semibold text-black dark:text-white">
          Thread{replyCount > 0 ? ` (${replyCount})` : ""}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close thread"
          className="rounded p-1 text-black/30 hover:bg-black/10 hover:text-black/60 dark:text-white/30 dark:hover:bg-white/10 dark:hover:text-white/60"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Thread messages */}
      <div className="flex-1 overflow-y-auto py-2">
        {threadMessages.map((msg, idx) => (
          <div key={msg.id} className={idx === 0 ? "mb-1 border-b border-black/5 pb-2 dark:border-white/5" : ""}>
            <MessageRow
              message={msg}
              myPubkey={myPubkey}
              showHeader
              profile={profiles.get(msg.pubkey)}
              reactions={reactions?.[msg.id]}
              onAddReaction={
                onAddReaction ? (emoji, url) => onAddReaction(msg.id, emoji, url) : undefined
              }
              onEdit={onEdit ? () => onEdit(msg) : undefined}
              onDelete={onDelete ? () => onDelete(msg) : undefined}
              customEmoji={customEmoji}
              customEmojiUrls={customEmojiUrls}
              onImportAgent={onImportAgent}
              onImportTeam={onImportTeam}
            />
          </div>
        ))}
        {replyCount === 0 && (
          <p className="px-4 pt-2 text-xs italic text-black/35 dark:text-white/35">
            No replies yet — start the thread below.
          </p>
        )}
      </div>

      {/* Relay rejection of a thread reply (permissions, validation) */}
      {sendError && (
        <div className="shrink-0 px-3 pb-1 text-[11px] text-red-600 dark:text-red-400">
          {sendError}
        </div>
      )}

      {/* Thread composer */}
      <div className="shrink-0 border-t border-black/10 p-2 dark:border-white/10">
        <MessageComposer
          channelName="thread"
          onSend={(content, mentionPubkeys) => handleThreadSend(content, mentionPubkeys)}
          isSending={sending}
          members={members}
          profiles={profiles}
          onTyping={onClearSendError}
          timeoutRejection={timeoutRejection}
        />
      </div>
    </div>
  );
}
