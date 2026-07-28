/**
 * Inbox: messages that p-tag the current user (mentions) across all channels.
 * One subscription: kinds 9/40002 with #p:[me].
 */

import { useEffect, useRef, useState } from "react";
import { useRelay } from "@/shared/context/relay-context";
import { KIND_STREAM_MSG, KIND_STREAM_MSG_V2 } from "../channels/types";
import type { NostrEvent } from "@/shared/lib/relay-connection";

export interface MentionHit {
  id: string;
  pubkey: string;
  content: string;
  createdAt: number;
  groupId: string;
}

const LIMIT = 100;

export function useMentions(): { mentions: MentionHit[]; isLoading: boolean } {
  const { connection, connectionState, identity } = useRelay();
  const myPubkey = identity?.pubkey;
  const [mentions, setMentions] = useState<MentionHit[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const seenRef = useRef(new Map<string, MentionHit>());

  useEffect(() => {
    if (!connection || connectionState !== "ready" || !myPubkey) return;
    seenRef.current = new Map();
    setMentions([]);
    setIsLoading(true);

    const unsub = connection.subscribe(
      { kinds: [KIND_STREAM_MSG, KIND_STREAM_MSG_V2], "#p": [myPubkey], limit: LIMIT },
      (ev: NostrEvent) => {
        if (ev.pubkey === myPubkey) return; // own messages aren't mentions
        const groupId = ev.tags.find((t) => t[0] === "h")?.[1];
        if (!groupId) return;
        seenRef.current.set(ev.id, {
          id: ev.id,
          pubkey: ev.pubkey,
          content: ev.content,
          createdAt: ev.created_at,
          groupId,
        });
        setMentions(
          [...seenRef.current.values()].sort((a, b) => b.createdAt - a.createdAt),
        );
      },
      () => setIsLoading(false),
    );

    return unsub;
  }, [connection, connectionState, myPubkey]);

  return { mentions, isLoading };
}
