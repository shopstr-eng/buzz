import { useMemo } from "react";
import type { ChatMessage } from "../types";
import { relativeTime } from "@/shared/lib/relative-time";

interface Props {
  message: ChatMessage;
  /** pubkey of the logged-in user */
  myPubkey?: string;
  /** Whether to show the sender header (false when consecutive messages from same sender) */
  showHeader: boolean;
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

export function MessageRow({ message, myPubkey, showHeader }: Props) {
  const isMe = myPubkey === message.pubkey;
  const bg = useMemo(() => avatarColor(message.pubkey), [message.pubkey]);
  const initial = message.pubkey[0]?.toUpperCase() ?? "?";
  const shortKey = truncatePubkey(message.pubkey);
  const timeStr = useMemo(
    () => relativeTime(message.createdAt),
    [message.createdAt],
  );

  return (
    <div
      className={`group flex items-start gap-3 px-4 py-0.5 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] ${
        showHeader ? "mt-3" : ""
      } ${message.isPending ? "opacity-60" : ""}`}
    >
      {/* Avatar column — only shown on first message in run */}
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
            <span
              className="text-sm font-semibold"
              style={{ color: isMe ? "#3b9dd3" : bg }}
            >
              {isMe ? "You" : shortKey}
            </span>
            <span className="text-[11px] text-black/35 dark:text-white/35">
              {timeStr}
            </span>
          </div>
        )}
        <p className="break-words text-sm leading-relaxed text-black/90 dark:text-white/90">
          {message.content}
        </p>
      </div>
    </div>
  );
}
