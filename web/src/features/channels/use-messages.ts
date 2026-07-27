/**
 * Subscribe to chat messages (kind 9, 40002) for a given NIP-29 group,
 * plus edits (kind 40003) and deletions (kind 5 / 9005).
 *
 * Strategy:
 *   1. On mount: fetch the last N events (history window) via a one-shot REQ.
 *   2. After EOSE: open a live subscription for new events (since = now).
 *   3. Merge and deduplicate, sorted by created_at ascending.
 *
 * Edits: the latest kind:40003 per target message wins; its content replaces
 * the original and `editedAt` is set (mirrors desktop formatTimelineMessages).
 * Deletions: kind 5 and kind 9005 both remove their e-tag targets (mirrors
 * the relay + desktop).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRelay } from "@/shared/context/relay-context";
import {
  KIND_DELETION,
  KIND_NIP29_DELETE,
  KIND_STREAM_MSG,
  KIND_STREAM_MSG_EDIT,
  KIND_STREAM_MSG_V2,
  KIND_SYSTEM_MESSAGE,
  type ChatMessage,
} from "./types";
import type { NostrEvent } from "@/shared/lib/relay-connection";

const HISTORY_LIMIT = 100;
const HEX_RE = /^[0-9a-f]{64}$/;

const TIMELINE_KINDS = [
  KIND_STREAM_MSG,
  KIND_STREAM_MSG_V2,
  KIND_STREAM_MSG_EDIT,
  KIND_SYSTEM_MESSAGE,
  KIND_DELETION,
  KIND_NIP29_DELETE,
];

function isDeletionKind(kind: number): boolean {
  return kind === KIND_DELETION || kind === KIND_NIP29_DELETE;
}

/** e-tag targets of a deletion event (64-hex ids only). */
function deletionTargets(ev: NostrEvent): string[] {
  return ev.tags
    .filter((t) => t[0] === "e" && typeof t[1] === "string" && HEX_RE.test(t[1]))
    .map((t) => t[1]);
}

/** Target message id of an edit: the LAST e-tag (mirrors desktop). */
function editTargetId(ev: NostrEvent): string | null {
  for (let i = ev.tags.length - 1; i >= 0; i--) {
    const t = ev.tags[i];
    if (t?.[0] === "e" && typeof t[1] === "string") return t[1];
  }
  return null;
}

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

interface EditRecord {
  content: string;
  createdAt: number;
}

export function useMessages(groupId: string | null): {
  messages: ChatMessage[];
  isLoading: boolean;
  /** Inject an optimistic message (before server confirmation). */
  addOptimistic: (msg: ChatMessage) => void;
  /** Optimistically apply an edit; the live sub confirms via kind:40003. */
  applyLocalEdit: (messageId: string, content: string) => void;
  /** Optimistically remove a message; the live sub confirms via kind 5/9005. */
  applyLocalDelete: (messageId: string) => void;
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
  /** targetId → latest edit seen (even if the target hasn't arrived yet). */
  const edits = useRef(new Map<string, EditRecord>());
  /** targetIds with an unconfirmed optimistic edit — the relay echo always
   *  replaces these regardless of client/relay clock skew. */
  const optimisticEdits = useRef(new Set<string>());
  /** ids removed by deletion events (messages and edits alike). */
  const deleted = useRef(new Set<string>());

  const rebuild = useCallback((): ChatMessage[] => {
    const list: ChatMessage[] = [];
    for (const msg of store.current.values()) {
      if (deleted.current.has(msg.id)) continue;
      const edit = edits.current.get(msg.id);
      if (edit) {
        list.push({ ...msg, content: edit.content, editedAt: edit.createdAt });
      } else {
        list.push(msg);
      }
    }
    return list.sort((a, b) => a.createdAt - b.createdAt);
  }, []);

  /** Route any timeline event (message, edit, deletion) into the store. */
  const ingest = useCallback(
    (ev: NostrEvent) => {
      if (isDeletionKind(ev.kind)) {
        let changed = false;
        for (const id of deletionTargets(ev)) {
          if (!deleted.current.has(id)) {
            deleted.current.add(id);
            changed = true;
          }
        }
        if (changed) setMessages(rebuild());
        return;
      }

      if (ev.kind === KIND_STREAM_MSG_EDIT) {
        const targetId = editTargetId(ev);
        if (!targetId || deleted.current.has(targetId) || deleted.current.has(ev.id)) {
          return;
        }
        const existing = edits.current.get(targetId);
        if (
          !existing ||
          optimisticEdits.current.has(targetId) ||
          ev.created_at > existing.createdAt
        ) {
          optimisticEdits.current.delete(targetId);
          edits.current.set(targetId, {
            content: ev.content,
            createdAt: ev.created_at,
          });
          setMessages(rebuild());
        }
        return;
      }

      const msg = eventToMessage(ev);
      if (deleted.current.has(msg.id)) return;
      store.current.set(msg.id, msg);
      setMessages(rebuild());
    },
    [rebuild],
  );

  // Reset when channel changes.
  useEffect(() => {
    store.current = new Map();
    edits.current = new Map();
    deleted.current = new Set();
    setMessages([]);
    setIsLoading(true);
    setOldestTs(null);
    setCanFetchOlder(false);
  }, [groupId]);

  useEffect(() => {
    if (!connection || connectionState !== "ready" || !groupId) return;

    store.current = new Map();
    edits.current = new Map();
    deleted.current = new Set();
    setMessages([]);
    setIsLoading(true);

    const now = Math.floor(Date.now() / 1000);

    // ── 1. history subscription (until now, latest N events) ──
    const historyUnsub = connection.subscribe(
      {
        kinds: TIMELINE_KINDS,
        "#h": [groupId],
        limit: HISTORY_LIMIT,
        until: now,
      },
      ingest,
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
        kinds: TIMELINE_KINDS,
        "#h": [groupId],
        since: now,
      },
      (ev) => {
        if (ev.kind === KIND_STREAM_MSG || ev.kind === KIND_STREAM_MSG_V2) {
          // Remove optimistic copy if present (same content + pubkey within 5s).
          const prev = messagesRef.current;
          const optimistic = prev.find(
            (m) =>
              m.isPending &&
              m.pubkey === ev.pubkey &&
              m.content === ev.content &&
              Math.abs(m.createdAt - ev.created_at) < 5,
          );
          if (optimistic) store.current.delete(optimistic.id);
        }
        ingest(ev);
      },
    );

    return () => {
      historyUnsub();
      liveUnsub();
    };
    // messagesRef is a stable ref; ingest/rebuild are stable callbacks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection, connectionState, groupId]);

  // Keep a ref of the latest messages for the live-sub optimistic sweep.
  const messagesRef = useRef<ChatMessage[]>([]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const addOptimistic = useCallback(
    (msg: ChatMessage) => {
      store.current.set(msg.id, msg);
      setMessages(rebuild());
    },
    [rebuild],
  );

  const applyLocalEdit = useCallback(
    (messageId: string, content: string) => {
      optimisticEdits.current.add(messageId);
      edits.current.set(messageId, {
        content,
        createdAt: Math.floor(Date.now() / 1000),
      });
      setMessages(rebuild());
    },
    [rebuild],
  );

  const applyLocalDelete = useCallback(
    (messageId: string) => {
      deleted.current.add(messageId);
      setMessages(rebuild());
    },
    [rebuild],
  );

  const fetchOlder = useCallback(() => {
    if (!connection || !groupId || oldestTs === null || !canFetchOlder) return;

    setCanFetchOlder(false);
    const before = oldestTs - 1;

    const unsub = connection.subscribe(
      {
        kinds: TIMELINE_KINDS,
        "#h": [groupId],
        limit: HISTORY_LIMIT,
        until: before,
      },
      ingest,
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
  }, [connection, groupId, oldestTs, canFetchOlder, ingest]);

  return {
    messages,
    isLoading,
    addOptimistic,
    applyLocalEdit,
    applyLocalDelete,
    fetchOlder,
    canFetchOlder,
  };
}
