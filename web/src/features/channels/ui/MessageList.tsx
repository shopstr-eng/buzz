import { useEffect, useRef, useMemo } from "react";
import type { ChatMessage } from "../types";
import { KIND_SYSTEM_MESSAGE } from "../types";
import type { ReactionsMap } from "../use-reactions";
import type { CustomEmoji } from "../use-custom-emoji";
import { MessageRow } from "./MessageRow";
import { useProfiles } from "@/shared/hooks/use-profiles";

interface Props {
  messages: ChatMessage[];
  myPubkey?: string;
  isLoading: boolean;
  canFetchOlder: boolean;
  onFetchOlder: () => void;
  reactions?: ReactionsMap;
  /** emoji is unicode or `:shortcode:`; emojiUrl set for custom emoji (NIP-30) */
  onAddReaction?: (messageId: string, emoji: string, emojiUrl?: string) => void;
  onReply?: (message: ChatMessage) => void;
  onEdit?: (message: ChatMessage) => void;
  onDelete?: (message: ChatMessage) => void;
  onOpenThread?: (message: ChatMessage) => void;
  /** Community custom emoji (NIP-30) for the reaction picker */
  customEmoji?: CustomEmoji[];
  /** shortcode → url for rendering :shortcode: tokens */
  customEmojiUrls?: Map<string, string>;
  /** Profiles for all channel members (kind:0 / kind:10100), pre-fetched by the
   *  parent.  Merged with author-only profiles so agent names and @-mention chips
   *  resolve even before the member has sent any messages. */
  memberProfiles?: Map<string, import("@/shared/hooks/use-profiles").Profile>;
}

/** shortKey matches the format inserted by MessageComposer: 8hex + … + 4hex */
function shortKey(pubkey: string): string {
  return `${pubkey.slice(0, 8)}\u2026${pubkey.slice(-4)}`;
}

/** Centered system row (kind 40099): joins, leaves, channel events, tombstones. */
function SystemMessageRow({
  msg,
  profiles,
}: {
  msg: ChatMessage;
  profiles: Map<string, import("@/shared/hooks/use-profiles").Profile>;
}) {
  const name = (pk?: string) =>
    pk ? (profiles.get(pk)?.name ?? `${pk.slice(0, 4)}\u2026${pk.slice(-4)}`) : "Someone";

  let text: string;
  try {
    const p = JSON.parse(msg.content) as {
      type?: string;
      actor?: string;
      target?: string;
      public_reason?: string;
    };
    switch (p.type) {
      case "member_added":
      case "member_joined":
      case "join":
        text = `${name(p.target ?? p.actor)} joined the channel`;
        break;
      case "member_removed":
      case "member_left":
      case "leave":
        text = `${name(p.target ?? p.actor)} left the channel`;
        break;
      case "channel_created":
        text = `${name(p.actor)} created the channel`;
        break;
      case "message_deleted":
        text = p.public_reason
          ? `A message was removed by a moderator (${p.public_reason})`
          : "A message was removed by a moderator";
        break;
      default:
        text = typeof p.type === "string" ? p.type.replace(/_/g, " ") : msg.content;
    }
  } catch {
    text = msg.content;
  }

  return (
    <div className="px-4 py-1 text-center text-[11px] italic text-black/40 dark:text-white/40">
      {text}
    </div>
  );
}

export function MessageList({
  messages,
  myPubkey,
  isLoading,
  canFetchOlder,
  onFetchOlder,
  reactions,
  onAddReaction,
  onReply,
  onEdit,
  onDelete,
  onOpenThread,
  customEmoji,
  customEmojiUrls,
  memberProfiles,
}: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const prevLengthRef = useRef(0);

  // Collect unique author pubkeys across all messages for profile subscription.
  const authorPubkeys = useMemo(() => {
    const seen = new Set<string>();
    for (const msg of messages) seen.add(msg.pubkey);
    return [...seen];
  }, [messages]);

  const authorProfiles = useProfiles(authorPubkeys);

  // Merge member profiles (all channel members, pre-fetched by the parent) with
  // author-only profiles.  Author profiles win on conflict so a user's own sent
  // messages always show their latest kind:0.  This ensures the agent's kind:10100
  // name resolves in message headers and @mention chips even before the agent has
  // sent its first message.
  const profiles = useMemo(() => {
    if (!memberProfiles?.size) return authorProfiles;
    const merged = new Map(memberProfiles);
    for (const [k, v] of authorProfiles) merged.set(k, v);
    return merged;
  }, [authorProfiles, memberProfiles]);

  // Build mention lookup: shortKey(pubkey) → display name.
  // Used by ContentWithMentions to replace @pubkey chips with real names.
  const mentionNames = useMemo(() => {
    const m = new Map<string, string>();
    for (const [pubkey, profile] of profiles) {
      if (profile.name) m.set(shortKey(pubkey), profile.name);
    }
    return m;
  }, [profiles]);

  const messagesById = useMemo(() => {
    const m = new Map<string, ChatMessage>();
    for (const msg of messages) m.set(msg.id, msg);
    return m;
  }, [messages]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const newMessages = messages.length > prevLengthRef.current;
    prevLengthRef.current = messages.length;
    if (!newMessages) return;
    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    if (distanceFromBottom < 200) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  if (isLoading) {
    return (
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-4">
        {Array.from({ length: 6 }).map((_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: skeleton
          <div key={i} className="flex items-start gap-3">
            <div className="h-8 w-8 shrink-0 animate-pulse rounded-full bg-black/10 dark:bg-white/10" />
            <div className="flex-1 space-y-1.5 pt-0.5">
              <div className="h-3 w-24 animate-pulse rounded bg-black/10 dark:bg-white/10" />
              <div
                className="h-3 animate-pulse rounded bg-black/10 dark:bg-white/10"
                style={{ width: `${40 + (i * 17) % 40}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-black/40 dark:text-white/40">
          No messages yet. Say hello! 👋
        </p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex flex-1 flex-col overflow-y-auto py-2">
      {canFetchOlder && (
        <div className="flex justify-center py-2">
          <button
            type="button"
            onClick={onFetchOlder}
            className="rounded-full bg-black/5 px-4 py-1.5 text-xs text-black/60 transition-colors hover:bg-black/10 dark:bg-white/5 dark:text-white/60 dark:hover:bg-white/10"
          >
            Load older messages
          </button>
        </div>
      )}

      {messages.map((msg, idx) => {
        if (msg.kind === KIND_SYSTEM_MESSAGE) {
          return <SystemMessageRow key={msg.id} msg={msg} profiles={profiles} />;
        }

        const prev = messages[idx - 1];
        const showHeader =
          !prev ||
          prev.pubkey !== msg.pubkey ||
          prev.kind === KIND_SYSTEM_MESSAGE ||
          msg.createdAt - prev.createdAt > 300;

        const replyToMsg = msg.replyToId
          ? messagesById.get(msg.replyToId) ?? null
          : null;

        const replyToProfile = replyToMsg
          ? profiles.get(replyToMsg.pubkey)
          : undefined;

        return (
          <MessageRow
            key={msg.id}
            message={msg}
            myPubkey={myPubkey}
            showHeader={showHeader}
            reactions={reactions?.[msg.id]}
            onAddReaction={
              onAddReaction ? (emoji, url) => onAddReaction(msg.id, emoji, url) : undefined
            }
            customEmoji={customEmoji}
            customEmojiUrls={customEmojiUrls}
            onReply={onReply ? () => onReply(msg) : undefined}
            onEdit={onEdit ? () => onEdit(msg) : undefined}
            onDelete={onDelete ? () => onDelete(msg) : undefined}
            onOpenThread={onOpenThread ? () => onOpenThread(msg) : undefined}
            replyToMessage={
              replyToMsg
                ? {
                    content: replyToMsg.content,
                    pubkey: replyToMsg.pubkey,
                    senderName: replyToProfile?.name ?? undefined,
                  }
                : null
            }
            profile={profiles.get(msg.pubkey)}
            replyToProfile={replyToProfile}
            mentionNames={mentionNames}
          />
        );
      })}

      <div ref={bottomRef} className="h-2" />
    </div>
  );
}
