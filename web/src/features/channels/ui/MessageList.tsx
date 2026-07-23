import { useEffect, useRef } from "react";
import type { ChatMessage } from "../types";
import { MessageRow } from "./MessageRow";

interface Props {
  messages: ChatMessage[];
  myPubkey?: string;
  isLoading: boolean;
  canFetchOlder: boolean;
  onFetchOlder: () => void;
}

export function MessageList({
  messages,
  myPubkey,
  isLoading,
  canFetchOlder,
  onFetchOlder,
}: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const prevLengthRef = useRef(0);

  // Auto-scroll to bottom when new messages arrive (only when already near bottom).
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
        const prev = messages[idx - 1];
        const showHeader =
          !prev ||
          prev.pubkey !== msg.pubkey ||
          msg.createdAt - prev.createdAt > 300; // 5-min break resets grouping
        return (
          <MessageRow
            key={msg.id}
            message={msg}
            myPubkey={myPubkey}
            showHeader={showHeader}
          />
        );
      })}

      <div ref={bottomRef} className="h-2" />
    </div>
  );
}
