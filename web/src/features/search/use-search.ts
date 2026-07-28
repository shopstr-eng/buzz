/**
 * Message search via the relay's NIP-50 `search` filter (kinds 9/40002).
 * Debounced; scoped to a channel when groupId is provided.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useRelay } from "@/shared/context/relay-context";
import { KIND_STREAM_MSG, KIND_STREAM_MSG_V2, type ChatMessage } from "../channels/types";
import type { NostrEvent } from "@/shared/lib/relay-connection";
import { isHexPubkey, parseSearchOperators } from "./lib/parse-search-operators";
import { useChannels } from "../channels/use-channels";

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
  const { channels } = useChannels();
  const [results, setResults] = useState<SearchHit[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const seenRef = useRef(new Map<string, SearchHit>());

  // Slack-style operators (desktop parity): from:<hex> in:<#name|uuid>
  // after:/before:YYYY-MM-DD. Unresolvable from:/in: values stay in the FTS
  // text so the search still returns something sensible.
  const parsed = useMemo(() => {
    const ops = parseSearchOperators(query);
    let { text, from, in: inValue } = ops;
    let author: string | null = null;
    let channelId: string | null = null;
    if (from) {
      if (isHexPubkey(from)) author = from.toLowerCase();
      else text = `${text} from:${from}`.trim();
    }
    if (inValue) {
      const stripped = inValue.replace(/^#/, "");
      const byName = channels.find(
        (c) => c.groupId === stripped || c.name.toLowerCase() === stripped.toLowerCase(),
      );
      if (byName) channelId = byName.groupId;
      else text = `${text} in:${inValue}`.trim();
    }
    return { text, author, channelId, since: ops.since, until: ops.until };
  }, [query, channels]);

  // Primitive deps only: `parsed` is a fresh object whenever channels stream
  // in, and depending on it would resubscribe on every channel update even
  // when the resolved values are unchanged.
  const { text: pText, author: pAuthor, channelId: pChannelId, since: pSince, until: pUntil } = parsed;

  useEffect(() => {
    const q = pText;
    if (!connection || connectionState !== "ready" || (q.length < MIN_QUERY_LEN && !pAuthor)) {
      setResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    let unsub: (() => void) | null = null;

    const timer = setTimeout(() => {
      seenRef.current = new Map();
      const effectiveChannel = groupId ?? pChannelId;
      unsub = connection.subscribe(
        {
          kinds: [KIND_STREAM_MSG, KIND_STREAM_MSG_V2],
          ...(q ? { search: q } : {}),
          ...(pAuthor ? { authors: [pAuthor] } : {}),
          ...(effectiveChannel ? { "#h": [effectiveChannel] } : {}),
          ...(pSince ? { since: pSince } : {}),
          ...(pUntil ? { until: pUntil } : {}),
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
  }, [connection, connectionState, pText, pAuthor, pChannelId, pSince, pUntil, groupId]);

  return { results, isSearching };
}
