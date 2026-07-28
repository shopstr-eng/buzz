/**
 * Per-channel read state + unread/mention badges.
 *
 * Read state lives in localStorage as the UI source of truth; use-sync-30078.ts
 * syncs it cross-client via encrypted NIP-RS slots (kind:30078, nip44-to-self,
 * max-per-key merge — desktop contract). Badges derive from a single light
 * subscription over recent stream messages (kinds 9, 40002, no #h filter).
 *
 * Badges cover the recent-activity window (last ~500 community messages).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useRelay } from "@/shared/context/relay-context";
import { KIND_STREAM_MSG, KIND_STREAM_MSG_V2 } from "./types";
import type { NostrEvent } from "@/shared/lib/relay-connection";

const LS_KEY = "buzz.readState.v1";
const HISTORY_LIMIT = 500;

export interface ChannelUnread {
  count: number;
  mention: boolean;
}

function loadLastRead(): Record<string, number> {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, number>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

// ── Module-level store so ChannelView can mark read without the hook ──
let lastReadMap: Record<string, number> = loadLastRead();
const listeners = new Set<() => void>();

function emit() {
  for (const fn of listeners) fn();
}

/** Subscribe to read-state changes (returns unsubscribe). */
export function subscribeReadState(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Snapshot of channel-level read markers (for NIP-RS slot publishing). */
export function getReadStateSnapshot(): Record<string, number> {
  return { ...lastReadMap };
}

/** Mark a channel read up to timestamp `ts` (unix seconds). */
export function markChannelRead(groupId: string, ts: number): void {
  if ((lastReadMap[groupId] ?? 0) >= ts) return;
  lastReadMap = { ...lastReadMap, [groupId]: ts };
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(lastReadMap));
  } catch {
    // quota — non-fatal
  }
  emit();
}

interface TrackedMessage {
  h: string;
  ts: number;
  mine: boolean;
  mention: boolean;
}

export function useReadState(): {
  unread: Map<string, ChannelUnread>;
} {
  const { connection, connectionState, identity } = useRelay();
  const myPubkey = identity?.pubkey;
  const messagesRef = useRef(new Map<string, TrackedMessage>());
  const [tick, setTick] = useState(0);

  // Recompute when markChannelRead fires from anywhere (e.g. ChannelView).
  useEffect(() => {
    const fn = () => setTick((t) => t + 1);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);

  useEffect(() => {
    if (!connection || connectionState !== "ready") return;
    messagesRef.current = new Map();
    // Force recomputation so badges from a prior session/user don't linger.
    setTick((t) => t + 1);

    const unsub = connection.subscribe(
      { kinds: [KIND_STREAM_MSG, KIND_STREAM_MSG_V2], limit: HISTORY_LIMIT },
      (ev: NostrEvent) => {
        const h = ev.tags.find((t) => t[0] === "h")?.[1];
        if (!h) return;
        const mine = ev.pubkey === myPubkey;
        const mention = !!myPubkey && ev.tags.some((t) => t[0] === "p" && t[1] === myPubkey);
        messagesRef.current.set(ev.id, { h, ts: ev.created_at, mine, mention });
        setTick((t) => t + 1);
      },
    );

    return unsub;
  }, [connection, connectionState, myPubkey]);

  const unread = useMemo(() => {
    const byChannel = new Map<string, ChannelUnread>();
    for (const msg of messagesRef.current.values()) {
      if (msg.mine) continue;
      const lastRead = lastReadMap[msg.h] ?? 0;
      if (msg.ts <= lastRead) continue;
      const entry = byChannel.get(msg.h) ?? { count: 0, mention: false };
      entry.count += 1;
      if (msg.mention) entry.mention = true;
      byChannel.set(msg.h, entry);
    }
    return byChannel;
    // tick bumps on every tracked event, markChannelRead, and reset.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  return { unread };
}
