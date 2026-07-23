/**
 * Subscribe to chat messages (kind 9, 40002) for a given NIP-29 group.
 *
 * Strategy:
 *   1. On mount: fetch the last N messages (history window) via a one-shot REQ.
 *   2. After EOSE: open a live subscription for new events (since = now).
 *   3. Merge and deduplicate, sorted by created_at ascending.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRelay } from "@/shared/context/relay-context";
import { KIND_STREAM_MSG, KIND_STREAM_MSG_V2, type ChatMessage } from "./types";
import type { NostrEvent } from "@/shared/lib/relay-connection";

const HISTORY_LIMIT = 100;

function eventToMessage(ev: NostrEvent): ChatMessage {
  const replyToId = ev.tags.find(
    (t) => t[0] === "e" && (t[3] === "reply" || !t[3]),
  )?.[1];
  return {
    id: ev.id,
    pubkey: ev.pubkey,
    content: ev.content,
    createdAt: ev.created_at,
    kind: ev.kind,
    replyToId,
  };
}

function mergeMessages(
  existing: Map<string, ChatMessage>,
  incoming: ChatMessage[],
): ChatMessage[] {
  for (const m of incoming) existing.set(m.id, m);
  return Array.from(existing.values()).sort((a, b) => a.createdAt - b.createdAt);
}

export function useMessages(groupId: string | null): {
  messages: ChatMessage[];
  isLoading: boolean;
  /** Inject an optimistic message (before server confirmation). */
  addOptimistic: (msg: ChatMessage) => void;
  /** Fetch older messages before the current window. */
  fetchOlder: () => void;
  canFetchOlder: boolean;
} {
  const { connection, connectionState } = useRelay();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [oldestTs, setOldestTs] = useState<number | null>(null);
  const [canFetchOlder, setCanFetchOlder] = useState(false);
  const store = useRef(new Map<string, ChatMessage>());

  // Reset when channel changes.
  useEffect(() => {
    store.current = new Map();
    setMessages([]);
    setIsLoading(true);
    setOldestTs(null);
    setCanFetchOlder(false);
  }, [groupId]);

  useEffect(() => {
    if (!connection || connectionState !== "ready" || !groupId) return;

    store.current = new Map();
    setMessages([]);
    setIsLoading(true);

    const now = Math.floor(Date.now() / 1000);

    // ── 1. history subscription (until now, latest N events) ──
    const historyUnsub = connection.subscribe(
      {
        kinds: [KIND_STREAM_MSG, KIND_STREAM_MSG_V2],
        "#h": [groupId],
        limit: HISTORY_LIMIT,
        until: now,
      },
      (ev) => {
        const msg = eventToMessage(ev);
        setMessages(mergeMessages(store.current, [msg]));
      },
      () => {
        // EOSE for history window.
        setIsLoading(false);
        const oldest = Array.from(store.current.values()).reduce<number | null>(
          (min, m) => (min === null || m.createdAt < min ? m.createdAt : min),
          null,
        );
        setOldestTs(oldest);
        setCanFetchOlder(store.current.size >= HISTORY_LIMIT);
        historyUnsub();
      },
    );

    // ── 2. live subscription (since now, streaming new events) ──
    const liveUnsub = connection.subscribe(
      {
        kinds: [KIND_STREAM_MSG, KIND_STREAM_MSG_V2],
        "#h": [groupId],
        since: now,
      },
      (ev) => {
        const msg = eventToMessage(ev);
        // Remove optimistic copy if present (same content + pubkey within 5s).
        setMessages((prev) => {
          const optimisticIdx = prev.findIndex(
            (m) =>
              m.isPending &&
              m.pubkey === msg.pubkey &&
              m.content === msg.content &&
              Math.abs(m.createdAt - msg.createdAt) < 5,
          );
          if (optimisticIdx !== -1) {
            store.current.delete(prev[optimisticIdx].id);
          }
          return mergeMessages(store.current, [msg]);
        });
      },
    );

    return () => {
      historyUnsub();
      liveUnsub();
    };
  }, [connection, connectionState, groupId]);

  const addOptimistic = useCallback((msg: ChatMessage) => {
    setMessages(mergeMessages(store.current, [msg]));
  }, []);

  const fetchOlder = useCallback(() => {
    if (!connection || !groupId || oldestTs === null || !canFetchOlder) return;

    setCanFetchOlder(false);
    const before = oldestTs - 1;

    const unsub = connection.subscribe(
      {
        kinds: [KIND_STREAM_MSG, KIND_STREAM_MSG_V2],
        "#h": [groupId],
        limit: HISTORY_LIMIT,
        until: before,
      },
      (ev) => {
        const msg = eventToMessage(ev);
        setMessages(mergeMessages(store.current, [msg]));
      },
      () => {
        const oldest = Array.from(store.current.values()).reduce<number | null>(
          (min, m) => (min === null || m.createdAt < min ? m.createdAt : min),
          null,
        );
        setOldestTs(oldest);
        setCanFetchOlder(store.current.size >= HISTORY_LIMIT);
        unsub();
      },
    );
  }, [connection, groupId, oldestTs, canFetchOlder]);

  return { messages, isLoading, addOptimistic, fetchOlder, canFetchOlder };
}
