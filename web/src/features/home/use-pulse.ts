/**
 * Pulse feed: kind:1 text notes (NIP-01), mirroring the desktop's Pulse tab.
 * Read-only global feed + a composer to post your own note.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRelay } from "@/shared/context/relay-context";
import { getSignFn } from "@/shared/lib/identity";
import type { NostrEvent } from "@/shared/lib/relay-connection";

export const KIND_TEXT_NOTE = 1;
const LIMIT = 100;

export interface PulseNote {
  id: string;
  pubkey: string;
  content: string;
  createdAt: number;
}

export function usePulse(): {
  notes: PulseNote[];
  isLoading: boolean;
  postNote: (content: string) => Promise<void>;
} {
  const { connection, connectionState, identity } = useRelay();
  const [notes, setNotes] = useState<PulseNote[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const seenRef = useRef(new Map<string, PulseNote>());

  useEffect(() => {
    if (!connection || connectionState !== "ready") return;
    seenRef.current = new Map();
    setNotes([]);
    setIsLoading(true);

    const unsub = connection.subscribe(
      { kinds: [KIND_TEXT_NOTE], limit: LIMIT },
      (ev: NostrEvent) => {
        seenRef.current.set(ev.id, {
          id: ev.id,
          pubkey: ev.pubkey,
          content: ev.content,
          createdAt: ev.created_at,
        });
        setNotes(
          [...seenRef.current.values()].sort((a, b) => b.createdAt - a.createdAt),
        );
      },
      () => setIsLoading(false),
    );

    return unsub;
  }, [connection, connectionState]);

  const postNote = useCallback(
    async (content: string) => {
      if (!connection || !identity) return;
      const trimmed = content.trim();
      if (!trimmed) return;
      const signFn = getSignFn();
      if (!signFn) throw new Error("No signing key available. Please log in again.");
      const signed = await signFn({
        kind: KIND_TEXT_NOTE,
        created_at: Math.floor(Date.now() / 1000),
        tags: [],
        content: trimmed,
      });
      connection.publish(signed);
    },
    [connection, identity],
  );

  return { notes, isLoading, postNote };
}
