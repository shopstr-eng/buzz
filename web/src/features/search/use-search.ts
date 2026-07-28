/**
 * Message search via the relay's NIP-50 `search` filter (kinds 9/40002).
 * Debounced; scoped to a channel when groupId is provided.
 */

import { useEffect, useRef, useState } from "react";
import { useRelay } from "@/shared/context/relay-context";
import { KIND_STREAM_MSG, KIND_STREAM_MSG_V2, type ChatMessage } from "../channels/types";
import type { NostrEvent } from "@/shared/lib/relay-connection";

const DEBOUNCE_MS = 350;
const MIN_QUERY_LEN = 2;
const RESULT_LIMIT = 100;

export interface SearchHit extends ChatMessage {
  groupId: string;
}

function eventToHit(ev: NostrEvent): SearchHit | null {
  const groupId = ev.tags.find((t) => t[0] === "h")?.[1];
  if (!groupId) return null;
  return {
    id: ev.id,
    pubkey: ev.pubkey,
    content: ev.content,
    createdAt: ev.created_at,
    kind: ev.kind,
    replyToId: ev.tags.find((t) => t[0] === "e")?.[1],
    groupId,
  };
}

export function useMessageSearch(query: string, groupId?: string): {
  results: SearchHit[];
  isSearching: boolean;
} {
  const { connection, connectionState } = useRelay();
  const [results, setResults] = useState<SearchHit[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const seenRef = useRef(new Map<string, SearchHit>());

  useEffect(() => {
    const q = query.trim();
    if (!connection || connectionState !== "ready" || q.length < MIN_QUERY_LEN) {
      setResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    let unsub: (() => void) | null = null;

    const timer = setTimeout(() => {
      seenRef.current = new Map();
      unsub = connection.subscribe(
        {
          kinds: [KIND_STREAM_MSG, KIND_STREAM_MSG_V2],
          search: q,
          ...(groupId ? { "#h": [groupId] } : {}),
          limit: RESULT_LIMIT,
        },
        (ev: NostrEvent) => {
          const hit = eventToHit(ev);
          if (!hit) return;
          seenRef.current.set(ev.id, hit);
          setResults(
            [...seenRef.current.values()].sort((a, b) => b.createdAt - a.createdAt),
          );
        },
        () => setIsSearching(false), // EOSE — initial page loaded
      );
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      unsub?.();
    };
  }, [connection, connectionState, query, groupId]);

  return { results, isSearching };
}
