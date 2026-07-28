import { useEffect, useMemo, useRef, useState } from "react";
import { AlarmClock, Ban, Clock, Copy, CornerUpLeft, Flag, MessagesSquare, MoreHorizontal, Pencil, Smile, TimerOff, Trash2, UserCheck } from "lucide-react";
import { jobKindLabel } from "../types";
import type { ChatMessage } from "../types";
import type { EmojiReactions } from "../use-reactions";
import type { CustomEmoji } from "../use-custom-emoji";
import { EmojiPicker } from "./EmojiPicker";
import { ProfilePopover } from "./ProfilePopover";
import { canonicalNpubKey } from "@/shared/lib/mention-npub";
import { relativeTime } from "@/shared/lib/relative-time";
import type { Profile } from "@/shared/hooks/use-profiles";

interface Props {
  message: ChatMessage;
  myPubkey?: string;
  showHeader: boolean;
  reactions?: EmojiReactions;
  onAddReaction?: (emoji: string, emojiUrl?: string) => void;
  onReply?: () => void;
  /** Community custom emoji (NIP-30) for the picker */
  customEmoji?: CustomEmoji[];
  /** shortcode → url for rendering :shortcode: in content and reaction chips */
  customEmojiUrls?: Map<string, string>;
  /** Start editing this message (own messages only) */
  onEdit?: () => void;
  /** Delete this message (own messages only) */
  onDelete?: () => void;
  /** Open the thread rooted at this message */
  onOpenThread?: () => void;
  /** Set a reminder anchored to this message */
  onRemind?: () => void;
  /** Current user is a channel moderator (enables timeout/ban actions) */
  canModerate?: boolean;
  /** Report this message to moderators */
  onReport?: () => void;
  /** Time out the author (moderator) */
  onTimeout?: () => void;
  /** Ban the author (moderator) */
  onBan?: () => void;
  /** Undo a community ban (moderator) */
  onUnban?: () => void;
  /** Lift an active timeout (moderator) */
  onUntimeout?: () => void;
  /** The message this message is replying to, for inline context */
  replyToMessage?: { content: string; pubkey: string; senderName?: string } | null;
  /** Resolved kind:0 / kind:10100 profile for this message's author */
  profile?: Profile;
  /** Resolved profile for the replied-to message's author */
  replyToProfile?: Profile;
  /**
   * Map from shortKey fragment (e.g. "abcdef01…cdef") to display name.
   * Used by ContentWithMentions to replace pubkey chips with real names.
   */
  mentionNames?: Map<string, string>;
}

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

/** Avatar: picture if available, otherwise coloured initial */
function Avatar({
  pubkey,
  profile,
  size = "md",
}: {
  pubkey: string;
  profile?: Profile;
  size?: "sm" | "md";
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const bg = avatarColor(pubkey);
  const cls =
    size === "sm"
      ? "h-4 w-4 rounded-full text-[8px] font-bold text-white"
      : "h-8 w-8 rounded-full text-xs font-semibold text-white";

  if (profile?.picture && !imgFailed) {
    return (
      <img
        src={profile.picture}
        alt=""
        className={`${cls} object-cover`}
        onError={() => setImgFailed(true)}
      />
    );
  }
  return (
    <div
      className={`flex shrink-0 items-center justify-center ${cls}`}
      style={{ backgroundColor: bg }}
    >
      {(profile?.name?.[0] ?? pubkey[0])?.toUpperCase() ?? "?"}
    </div>
  );
}

/**
 * Render message content, replacing @mention pubkey chips with display names
 * when a mentionNames map is supplied.
 */
/** Replace :shortcode: tokens with custom emoji images (NIP-30). */
function renderCustomEmojiTokens(
  text: string,
  customEmojiUrls?: Map<string, string>,
): React.ReactNode[] {
  if (!customEmojiUrls?.size) return [text];
  const EMOJI_RE = /:([a-z0-9_+-]+):/g;
  const parts: React.ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = EMOJI_RE.exec(text)) !== null) {
    const url = customEmojiUrls.get(match[1]);
    if (!url) continue;
    if (match.index > last) parts.push(text.slice(last, match.index));
    parts.push(
      <img
        key={match.index}
        src={url}
        alt={`:${match[1]}:`}
        title={`:${match[1]}:`}
        className="inline-block h-5 w-5 align-text-bottom object-contain"
        loading="lazy"
      />,
    );
    last = match.index + match[0].length;
  }
  if (last === 0) return [text];
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function ContentWithMentions({
  content,
  mentionNames,
  customEmojiUrls,
}: {
  content: string;
  mentionNames?: Map<string, string>;
  customEmojiUrls?: Map<string, string>;
}) {
  const MENTION_RE = /@([0-9a-f]{6,8})\u2026([0-9a-f]{3,6})|nostr:(npub1[a-z0-9]+)/gi;

  const parts: React.ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = MENTION_RE.exec(content)) !== null) {
    if (match.index > last) parts.push(...renderCustomEmojiTokens(content.slice(last, match.index), customEmojiUrls));

    let displayLabel: string;
    if (match[3]) {
      // nostr:npub1… — resolve to the profile name when mentionNames (keyed by
      // lowercase npubEncode output in MessageList) has it; tokens may arrive
      // in any case, so normalize before lookup. Fall back to a truncated npub.
      const resolvedNpubName = mentionNames?.get(canonicalNpubKey(match[3]));
      displayLabel = resolvedNpubName ? `@${resolvedNpubName}` : `@${match[3].slice(0, 10)}…`;
    } else {
      const fragment = `${match[1]}\u2026${match[2]}`;
      const resolvedName = mentionNames?.get(fragment);
      displayLabel = resolvedName ? `@${resolvedName}` : `@${match[1]}…${match[2]}`;
    }

    parts.push(
      <span
        key={match.index}
        className="inline-flex items-center rounded bg-violet-100 px-1 py-0.5 font-mono text-[11px] font-medium text-violet-700 dark:bg-violet-900/40 dark:text-violet-300"
      >
        {displayLabel}
      </span>,
    );
    last = match.index + match[0].length;
  }
  if (last < content.length) parts.push(...renderCustomEmojiTokens(content.slice(last), customEmojiUrls));

  return <>{parts}</>;
}

/** Inline reply-to quote banner */
function ReplyContext({
  content,
  pubkey,
  senderName,
  profile,
}: {
  content: string;
  pubkey: string;
  senderName?: string;
  profile?: Profile;
}) {
  const color = avatarColor(pubkey);
  const label = senderName ?? profile?.name ?? truncatePubkey(pubkey);
  return (
    <div
      className="mb-1 flex items-start gap-1.5 rounded border-l-2 bg-black/[0.03] px-2 py-1 dark:bg-white/[0.04]"
      style={{ borderLeftColor: color }}
    >
      <span className="min-w-0 truncate text-[11px] text-black/50 dark:text-white/50">
        <span className="font-semibold" style={{ color }}>
          {label}
        </span>{" "}
        {content.slice(0, 100)}{content.length > 100 ? "…" : ""}
      </span>
    </div>
  );
}

function ReactionRow({
  reactions,
  onAdd,
  customEmojiUrls,
}: {
  reactions: EmojiReactions;
  onAdd: (emoji: string) => void;
  customEmojiUrls?: Map<string, string>;
}) {
  const entries = Object.entries(reactions).filter(([, v]) => v.count > 0);
  if (entries.length === 0) return null;

  const renderEmoji = (emoji: string) => {
    const m = /^:([a-z0-9_+-]+):$/.exec(emoji);
    const url = m ? customEmojiUrls?.get(m[1]) : undefined;
    if (url) {
      return <img src={url} alt={emoji} title={emoji} className="h-4 w-4 object-contain" loading="lazy" />;
    }
    return <span>{emoji}</span>;
  };

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
          {renderEmoji(emoji)}
          <span className="font-medium">{count}</span>
        </button>
      ))}
    </div>
  );
}

/** Dropdown menu with copy/edit/delete actions (desktop-style context menu). */
function MessageMenu({
  canEdit,
  canModerate,
  onCopy,
  onEdit,
  onDelete,
  onOpenThread,
  onRemind,
  onReport,
  onTimeout,
  onBan,
  onUnban,
  onUntimeout,
}: {
  canEdit: boolean;
  canModerate: boolean;
  onCopy: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onOpenThread?: () => void;
  onRemind?: () => void;
  onReport?: () => void;
  onTimeout?: () => void;
  onBan?: () => void;
  onUnban?: () => void;
  onUntimeout?: () => void;
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        // Parent closes the menu; just reset local confirm state.
        setConfirmingDelete(false);
      }
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, []);

  const itemCls =
    "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-black/80 hover:bg-black/5 dark:text-white/80 dark:hover:bg-white/10";

  return (
    <div ref={ref} className="w-44 overflow-hidden rounded-lg border border-black/10 bg-white py-1 shadow-lg dark:border-white/10 dark:bg-[#252525]">
      {onOpenThread && (
        <button type="button" onMouseDown={(e) => { e.preventDefault(); onOpenThread(); }} className={itemCls}>
          <MessagesSquare className="h-3.5 w-3.5 text-black/40 dark:text-white/40" />
          Open thread
        </button>
      )}
      <button type="button" onMouseDown={(e) => { e.preventDefault(); onCopy(); }} className={itemCls}>
        <Copy className="h-3.5 w-3.5 text-black/40 dark:text-white/40" />
        Copy text
      </button>
      {onRemind && (
        <button type="button" onMouseDown={(e) => { e.preventDefault(); onRemind(); }} className={itemCls}>
          <AlarmClock className="h-3.5 w-3.5 text-black/40 dark:text-white/40" />
          Remind me
        </button>
      )}
      {onReport && !canEdit && (
        <button type="button" onMouseDown={(e) => { e.preventDefault(); onReport(); }} className={itemCls}>
          <Flag className="h-3.5 w-3.5 text-black/40 dark:text-white/40" />
          Report message
        </button>
      )}
      {canModerate && !canEdit && onTimeout && (
        <button type="button" onMouseDown={(e) => { e.preventDefault(); onTimeout(); }} className={itemCls}>
          <Clock className="h-3.5 w-3.5 text-black/40 dark:text-white/40" />
          Time out user
        </button>
      )}
      {canModerate && !canEdit && onBan && (
        <button type="button" onMouseDown={(e) => { e.preventDefault(); onBan(); }} className={`${itemCls} text-red-600 dark:text-red-400`}>
          <Ban className="h-3.5 w-3.5" />
          Ban user
        </button>
      )}
      {canModerate && !canEdit && onUnban && (
        <button type="button" onMouseDown={(e) => { e.preventDefault(); onUnban(); }} className={itemCls}>
          <UserCheck className="h-3.5 w-3.5 text-black/40 dark:text-white/40" />
          Unban user
        </button>
      )}
      {canModerate && !canEdit && onUntimeout && (
        <button type="button" onMouseDown={(e) => { e.preventDefault(); onUntimeout(); }} className={itemCls}>
          <TimerOff className="h-3.5 w-3.5 text-black/40 dark:text-white/40" />
          Lift timeout
        </button>
      )}
      {canEdit && onEdit && (
        <button type="button" onMouseDown={(e) => { e.preventDefault(); onEdit(); }} className={itemCls}>
          <Pencil className="h-3.5 w-3.5 text-black/40 dark:text-white/40" />
          Edit message
        </button>
      )}
      {canEdit && onDelete && !confirmingDelete && (
        <button
          type="button"
          onMouseDown={(e) => { e.preventDefault(); setConfirmingDelete(true); }}
          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete message
        </button>
      )}
      {canEdit && onDelete && confirmingDelete && (
        <div className="px-3 py-1.5">
          <p className="mb-1.5 text-[11px] text-black/60 dark:text-white/60">
            Delete this message?
          </p>
          <div className="flex gap-1.5">
            <button
              type="button"
              onMouseDown={(e) => { e.preventDefault(); onDelete(); }}
              className="rounded bg-red-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-red-700"
            >
              Delete
            </button>
            <button
              type="button"
              onMouseDown={(e) => { e.preventDefault(); setConfirmingDelete(false); }}
              className="rounded bg-black/5 px-2 py-1 text-[11px] text-black/60 hover:bg-black/10 dark:bg-white/10 dark:text-white/60 dark:hover:bg-white/15"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
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
  onEdit,
  onDelete,
  onOpenThread,
  onRemind,
  canModerate,
  onReport,
  onTimeout,
  onBan,
  onUnban,
  onUntimeout,
  customEmoji,
  customEmojiUrls,
  replyToMessage,
  profile,
  replyToProfile,
  mentionNames,
}: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const isMe = myPubkey === message.pubkey;
  const bg = useMemo(() => avatarColor(message.pubkey), [message.pubkey]);
  const displayName = isMe
    ? "You"
    : (profile?.name ?? truncatePubkey(message.pubkey));
  const timeStr = useMemo(() => relativeTime(message.createdAt), [message.createdAt]);
  const hasMention = /@[0-9a-f]{6,8}\u2026[0-9a-f]{3,6}|nostr:npub1/i.test(message.content);
  const hasCustomEmoji = customEmojiUrls?.size
    ? /:[a-z0-9_+-]+:/.test(message.content)
    : false;

  return (
    <div
      className={`group relative flex items-start gap-3 px-4 py-0.5 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] ${
        showHeader ? "mt-3" : ""
      } ${message.isPending ? "opacity-60" : ""}`}
    >
      {/* Avatar column */}
      <div className="relative w-8 shrink-0">
        {showHeader ? (
          <>
            <button
              type="button"
              onClick={() => setPopoverOpen((o) => !o)}
              className="block rounded-full transition-opacity hover:opacity-80"
              title="View profile"
            >
              <Avatar pubkey={message.pubkey} profile={profile} />
            </button>
            {popoverOpen && (
              <ProfilePopover
                pubkey={message.pubkey}
                profile={profile}
                onClose={() => setPopoverOpen(false)}
              />
            )}
          </>
        ) : null}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        {showHeader && (
          <div className="flex items-baseline gap-2">
            <span
              className="text-sm font-semibold"
              style={{ color: isMe ? "#3b9dd3" : bg }}
              title={message.pubkey}
            >
              {displayName}
            </span>
            <span className="text-[11px] text-black/35 dark:text-white/35">{timeStr}</span>
            {jobKindLabel(message.kind) && (
              <span className="rounded-full bg-violet-100 px-1.5 py-px text-[10px] font-medium text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
                {jobKindLabel(message.kind)}
              </span>
            )}
            {message.editedAt && (
              <span className="text-[11px] italic text-black/30 dark:text-white/30" title={relativeTime(message.editedAt)}>
                (edited)
              </span>
            )}
          </div>
        )}

        {replyToMessage && (
          <ReplyContext
            content={replyToMessage.content}
            pubkey={replyToMessage.pubkey}
            senderName={replyToMessage.senderName}
            profile={replyToProfile}
          />
        )}

        <p className="break-words text-sm leading-relaxed text-black/90 dark:text-white/90">
          {hasMention || hasCustomEmoji
            ? <ContentWithMentions content={message.content} mentionNames={mentionNames} customEmojiUrls={customEmojiUrls} />
            : message.content}
          {message.editedAt && !showHeader && (
            <span className="ml-1 text-[11px] italic text-black/30 dark:text-white/30">
              (edited)
            </span>
          )}
        </p>

        {reactions && onAddReaction && (
          <ReactionRow reactions={reactions} onAdd={onAddReaction} customEmojiUrls={customEmojiUrls} />
        )}
      </div>

      {/* Hover toolbar */}
      <div className="absolute right-4 top-0 hidden -translate-y-1/2 items-center gap-0.5 rounded-lg border border-black/10 bg-white p-0.5 shadow-sm group-hover:flex dark:border-white/10 dark:bg-[#222]">
        {onAddReaction && (
          <div className="relative">
            <button
              type="button"
              onClick={() => setPickerOpen((o) => !o)}
              className="rounded p-1.5 text-black/40 hover:bg-black/5 hover:text-black/70 dark:text-white/40 dark:hover:bg-white/10 dark:hover:text-white/70"
              title="React"
            >
              <Smile className="h-3.5 w-3.5" />
            </button>
            {pickerOpen && (
              <>
                <div className="fixed inset-0 z-10" onMouseDown={() => setPickerOpen(false)} />
                <div className="absolute right-0 top-full z-20 mt-1">
                  <EmojiPicker
                    customEmoji={customEmoji}
                    onSelect={(e, url) => {
                      onAddReaction(e, url);
                      setPickerOpen(false);
                    }}
                  />
                </div>
              </>
            )}
          </div>
        )}
        {onReply && (
          <button
            type="button"
            onClick={onReply}
            className="rounded p-1.5 text-black/40 hover:bg-black/5 hover:text-black/70 dark:text-white/40 dark:hover:bg-white/10 dark:hover:text-white/70"
            title="Reply"
          >
            <CornerUpLeft className="h-3.5 w-3.5" />
          </button>
        )}
        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            className="rounded p-1.5 text-black/40 hover:bg-black/5 hover:text-black/70 dark:text-white/40 dark:hover:bg-white/10 dark:hover:text-white/70"
            title="More"
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </button>
          {menuOpen && (
            <>
              {/* Click-outside backdrop */}
              <div className="fixed inset-0 z-10" onMouseDown={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-full z-20 mt-1">
                <MessageMenu
                  canEdit={isMe}
                  onCopy={() => {
                    void navigator.clipboard?.writeText(message.content).catch(() => {});
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                    setMenuOpen(false);
                  }}
                  onEdit={onEdit ? () => { onEdit(); setMenuOpen(false); } : undefined}
                  onDelete={onDelete ? () => { onDelete(); setMenuOpen(false); } : undefined}
                  onOpenThread={onOpenThread ? () => { onOpenThread(); setMenuOpen(false); } : undefined}
                  onRemind={onRemind ? () => { onRemind(); setMenuOpen(false); } : undefined}
                  canModerate={canModerate ?? false}
                  onReport={onReport ? () => { onReport(); setMenuOpen(false); } : undefined}
                  onTimeout={onTimeout ? () => { onTimeout(); setMenuOpen(false); } : undefined}
                  onBan={onBan ? () => { onBan(); setMenuOpen(false); } : undefined}
                  onUnban={onUnban ? () => { onUnban(); setMenuOpen(false); } : undefined}
                  onUntimeout={onUntimeout ? () => { onUntimeout(); setMenuOpen(false); } : undefined}
                />
              </div>
            </>
          )}
        </div>
      </div>
      {copied && (
        <div className="absolute right-4 top-0 -translate-y-full rounded bg-black/80 px-2 py-0.5 text-[10px] text-white dark:bg-white/80 dark:text-black">
          Copied
        </div>
      )}
    </div>
  );
}
