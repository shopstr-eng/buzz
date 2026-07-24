import { useMemo, useState } from "react";
import { CornerUpLeft, Smile } from "lucide-react";
import type { ChatMessage } from "../types";
import type { EmojiReactions } from "../use-reactions";
import { QUICK_EMOJIS } from "../use-reactions";
import { relativeTime } from "@/shared/lib/relative-time";

interface Props {
  message: ChatMessage;
  /** pubkey of the logged-in user */
  myPubkey?: string;
  /** Whether to show the sender header (false when consecutive messages from same sender) */
  showHeader: boolean;
  /** Reactions for this specific message */
  reactions?: EmojiReactions;
  /** Called when user clicks a reaction emoji */
  onAddReaction?: (emoji: string) => void;
  /** Called when user clicks the Reply button */
  onReply?: () => void;
  /** The message this message is replying to, for inline context */
  replyToMessage?: { content: string; pubkey: string } | null;
}

/** Colourful deterministic avatar background from pubkey */
function avatarColor(pubkey: string): string {
  const colors = [
    "#e35b4e", "#e8864d", "#d4a017", "#4caf73",
    "#3b9dd3", "#7b72e9", "#c264d0", "#e05b8c",
  ];
  let hash = 0;
  for (let i = 0; i < pubkey.length; i++) {
    hash = (hash * 31 + pubkey.charCodeAt(i)) >>> 0;
  }
  return colors[hash % colors.length];
}

function truncatePubkey(pubkey: string): string {
  return `${pubkey.slice(0, 4)}…${pubkey.slice(-4)}`;
}

/**
 * Parse message content and highlight @mentions.
 * Mentions are inserted as `@{8hexchars}…{4hexchars}` by the composer picker,
 * or as `nostr:npub1…` for NIP-27 compatibility.
 * Both patterns are rendered as a violet chip.
 */
function ContentWithMentions({ content }: { content: string }) {
  const MENTION_RE = /@([0-9a-f]{6,8})\u2026([0-9a-f]{3,6})|nostr:(npub1[a-z0-9]+)/gi;

  const parts: React.ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = MENTION_RE.exec(content)) !== null) {
    if (match.index > last) {
      parts.push(content.slice(last, match.index));
    }
    const display = match[3]
      ? `@${match[3].slice(0, 10)}…`
      : `@${match[1]}…${match[2]}`;
    parts.push(
      <span
        key={match.index}
        className="inline-flex items-center rounded bg-violet-100 px-1 py-0.5 font-mono text-[11px] font-medium text-violet-700 dark:bg-violet-900/40 dark:text-violet-300"
      >
        {display}
      </span>,
    );
    last = match.index + match[0].length;
  }
  if (last < content.length) {
    parts.push(content.slice(last));
  }

  return <>{parts}</>;
}

/** Inline reply-to quote banner */
function ReplyContext({ content, pubkey }: { content: string; pubkey: string }) {
  const color = avatarColor(pubkey);
  return (
    <div
      className="mb-1 flex items-start gap-1.5 rounded border-l-2 bg-black/[0.03] px-2 py-1 dark:bg-white/[0.04]"
      style={{ borderLeftColor: color }}
    >
      <span className="min-w-0 truncate text-[11px] text-black/50 dark:text-white/50">
        <span className="font-semibold" style={{ color }}>
          {truncatePubkey(pubkey)}
        </span>{" "}
        {content.slice(0, 100)}{content.length > 100 ? "…" : ""}
      </span>
    </div>
  );
}

/** Reaction chip row beneath a message */
function ReactionRow({
  reactions,
  onAdd,
}: {
  reactions: EmojiReactions;
  onAdd: (emoji: string) => void;
}) {
  const entries = Object.entries(reactions).filter(([, v]) => v.count > 0);
  if (entries.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {entries.map(([emoji, { count, mine }]) => (
        <button
          key={emoji}
          type="button"
          onClick={() => onAdd(emoji)}
          className={`flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[11px] transition-colors ${
            mine
              ? "border-violet-400 bg-violet-50 text-violet-700 dark:border-violet-500 dark:bg-violet-900/30 dark:text-violet-300"
              : "border-black/10 bg-black/[0.03] text-black/60 hover:bg-black/[0.06] dark:border-white/10 dark:bg-white/[0.04] dark:text-white/60 dark:hover:bg-white/[0.08]"
          }`}
        >
          <span>{emoji}</span>
          <span className="font-medium">{count}</span>
        </button>
      ))}
    </div>
  );
}

/** Floating quick-react emoji picker */
function QuickReactPicker({ onSelect }: { onSelect: (emoji: string) => void }) {
  return (
    <div className="flex items-center gap-0.5 rounded-lg border border-black/10 bg-white p-1 shadow-md dark:border-white/10 dark:bg-[#252525]">
      {QUICK_EMOJIS.map((e) => (
        <button
          key={e}
          type="button"
          onMouseDown={(ev) => { ev.preventDefault(); onSelect(e); }}
          className="rounded p-1 text-base leading-none hover:bg-black/5 dark:hover:bg-white/10"
        >
          {e}
        </button>
      ))}
    </div>
  );
}

export function MessageRow({
  message,
  myPubkey,
  showHeader,
  reactions,
  onAddReaction,
  onReply,
  replyToMessage,
}: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const isMe = myPubkey === message.pubkey;
  const bg = useMemo(() => avatarColor(message.pubkey), [message.pubkey]);
  const initial = message.pubkey[0]?.toUpperCase() ?? "?";
  const shortKey = truncatePubkey(message.pubkey);
  const timeStr = useMemo(() => relativeTime(message.createdAt), [message.createdAt]);
  const hasMention = /@[0-9a-f]{6,8}\u2026[0-9a-f]{3,6}|nostr:npub1/.test(message.content);

  return (
    <div
      className={`group relative flex items-start gap-3 px-4 py-0.5 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] ${
        showHeader ? "mt-3" : ""
      } ${message.isPending ? "opacity-60" : ""}`}
    >
      {/* Avatar column */}
      <div className="w-8 shrink-0">
        {showHeader ? (
          <div
            className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold text-white"
            style={{ backgroundColor: bg }}
          >
            {initial}
          </div>
        ) : null}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        {showHeader && (
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-semibold" style={{ color: isMe ? "#3b9dd3" : bg }}>
              {isMe ? "You" : shortKey}
            </span>
            <span className="text-[11px] text-black/35 dark:text-white/35">{timeStr}</span>
          </div>
        )}

        {/* Reply context */}
        {replyToMessage && (
          <ReplyContext content={replyToMessage.content} pubkey={replyToMessage.pubkey} />
        )}

        <p className="break-words text-sm leading-relaxed text-black/90 dark:text-white/90">
          {hasMention ? <ContentWithMentions content={message.content} /> : message.content}
        </p>

        {/* Reactions */}
        {reactions && onAddReaction && (
          <ReactionRow reactions={reactions} onAdd={onAddReaction} />
        )}
      </div>

      {/* Hover action bar — reply + react */}
      {(onReply || onAddReaction) && (
        <div className="absolute right-4 top-0 hidden -translate-y-1/2 items-center gap-0.5 rounded-lg border border-black/10 bg-white p-0.5 shadow-sm group-hover:flex dark:border-white/10 dark:bg-[#252525]">
          {onReply && (
            <button
              type="button"
              onClick={onReply}
              title="Reply"
              className="rounded p-1 text-black/40 hover:bg-black/5 hover:text-black/70 dark:text-white/40 dark:hover:bg-white/10 dark:hover:text-white/70"
            >
              <CornerUpLeft className="h-3.5 w-3.5" />
            </button>
          )}
          {onAddReaction && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setPickerOpen((o) => !o)}
                title="React"
                className="rounded p-1 text-black/40 hover:bg-black/5 hover:text-black/70 dark:text-white/40 dark:hover:bg-white/10 dark:hover:text-white/70"
              >
                <Smile className="h-3.5 w-3.5" />
              </button>
              {pickerOpen && (
                <div className="absolute bottom-full right-0 mb-1 z-20">
                  <QuickReactPicker
                    onSelect={(emoji) => {
                      onAddReaction(emoji);
                      setPickerOpen(false);
                    }}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
