/**
 * Per-channel read state + unread/mention badges.
 *
 * Read state lives in localStorage as the UI source of truth; use-sync-30078.ts
 * syncs it cross-client via encrypted NIP-RS slots (kind:30078, nip44-to-self,
 * max-per-key merge — desktop contract). Badges derive from a single light
 * subscription over recent stream messages (kinds 9, 40002, no #h filter).
 *
 * Manual mark-unread (NIP-RS override layer): the durable cross-client verdict
 * is the ov_* group written by use-sync-30078. This module mirrors desktop's
 * local forced-unread semantics for the badge: the channel's read marker is
 * reverted to its mark-time baseline and the channel renders DOT-ONLY until
 * any read (local or cross-device) advances the marker past that baseline.
 *
 * Badges cover the recent-activity window (last ~500 community messages).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useRelay } from "@/shared/context/relay-context";
import { KIND_STREAM_MSG, KIND_STREAM_MSG_V2 } from "./types";
import { overrideActive, type OverrideRegister } from "./lib/unread-override";
import type { NostrEvent } from "@/shared/lib/relay-connection";

const LS_KEY = "buzz.readState.v1";
const LS_FORCED_KEY = "buzz.forcedUnread.v1";
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

function loadForced(): Record<string, number> {
  try {
    const raw = localStorage.getItem(LS_FORCED_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, number>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "number" && Number.isFinite(v) && v >= 0) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

// ── Module-level store so ChannelView can mark read without the hook ──
let lastReadMap: Record<string, number> = loadLastRead();
/** channelId → read marker (unix secs) at mark-unread time (desktop baseline). */
let forcedMap: Record<string, number> = loadForced();
const listeners = new Set<() => void>();

function emit() {
  for (const fn of listeners) fn();
}

function persist() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(lastReadMap));
    localStorage.setItem(LS_FORCED_KEY, JSON.stringify(forcedMap));
  } catch {
    // quota — non-fatal
  }
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

/** Current local read marker for a channel (0 = never marked). */
export function getChannelMarker(groupId: string): number {
  return lastReadMap[groupId] ?? 0;
}

/** Snapshot of forced-unread baselines (channelId → baseline marker). */
export function getForcedSnapshot(): Record<string, number> {
  return { ...forcedMap };
}

/** Mark a channel read up to timestamp `ts` (unix seconds). */
export function markChannelRead(groupId: string, ts: number): void {
  if ((lastReadMap[groupId] ?? 0) >= ts) return;
  lastReadMap = { ...lastReadMap, [groupId]: ts };
  // A read past the force baseline (local or cross-device) covers the force.
  if (forcedMap[groupId] !== undefined && ts > forcedMap[groupId]) {
    forcedMap = { ...forcedMap };
    delete forcedMap[groupId];
  }
  persist();
  emit();
}

/**
 * Manual mark-unread: revert the local marker to the marker at mark time and
 * pin the channel as forced-unread (dot-only) until a read covers the
 * baseline. The cross-client verdict travels via the NIP-RS override group
 * (use-sync-30078) — this is web's local UI mirror, matching desktop's
 * forcedUnreadStore semantics.
 */
export function markChannelForcedUnread(groupId: string, baseline: number): void {
  lastReadMap = { ...lastReadMap, [groupId]: baseline };
  forcedMap = { ...forcedMap, [groupId]: baseline };
  persist();
  emit();
}

/**
 * Explicit local force release (mark-read action): drop the forced-unread pin
 * regardless of whether the marker covered the baseline — the NIP-RS ov_c
 * increment (use-sync-30078) is the durable cross-client verdict; this clears
 * the dot immediately even when a future-dated message skewed the frontier so
 * the marker cannot advance past the baseline.
 */
export function clearChannelForcedUnread(groupId: string): void {
  if (forcedMap[groupId] === undefined) return;
  forcedMap = { ...forcedMap };
  delete forcedMap[groupId];
  persist();
  emit();
}

/**
 * Mirror the merged wire state (NIP-RS override registers + frontier) into
 * the local badge store, so a mark-unread made on ANOTHER client lights the
 * dot here — and a remote clear (or a frontier advance past the baseline)
 * releases it. Channel-level contexts only; msg:/thread: overrides have no
 * badge representation.
 */
export function syncForcedFromOverrides(
  overrides: Record<string, OverrideRegister>,
  frontier: Record<string, number>,
): void {
  let changed = false;
  for (const [ctx, reg] of Object.entries(overrides)) {
    if (ctx.startsWith("msg:") || ctx.startsWith("thread:")) continue;
    if (overrideActive(reg, frontier[ctx] ?? 0)) {
      if (forcedMap[ctx] !== reg.b) {
        forcedMap = { ...forcedMap, [ctx]: reg.b };
        changed = true;
      }
      // Desktop mirror: revert the local marker to the override baseline so
      // the badge recomputes against it. Never raise the marker here.
      if ((lastReadMap[ctx] ?? 0) > reg.b) {
        lastReadMap = { ...lastReadMap, [ctx]: reg.b };
        changed = true;
      }
    } else if (forcedMap[ctx] !== undefined && forcedMap[ctx] === reg.b) {
      // Release only the force pinning THIS baseline — a newer local or
      // remote force (different baseline) is not this register's to clear.
      forcedMap = { ...forcedMap };
      delete forcedMap[ctx];
      changed = true;
    }
  }
  if (changed) {
    persist();
    emit();
  }
}

interface TrackedMessage {
  h: string;
  ts: number;
  mine: boolean;
  mention: boolean;
}

/**
 * Pure badge verdict: forced channels render dot-only while their marker has
 * not covered the baseline; everything else counts unseen remote messages.
 * Exported for tests (the hook feeds it the tracked message window).
 */
export function computeUnreadMap(
  messages: Iterable<TrackedMessage>,
  forced: Record<string, number>,
  lastRead: Record<string, number>,
): Map<string, ChannelUnread> {
  const byChannel = new Map<string, ChannelUnread>();
  for (const [h, baseline] of Object.entries(forced)) {
    if ((lastRead[h] ?? 0) > baseline) continue; // read covered the force
    byChannel.set(h, { count: 1, mention: false }); // dot tier only (desktop)
  }
  for (const msg of messages) {
    if (msg.mine) continue;
    if (byChannel.has(msg.h)) continue; // forced channels stay dot-only
    const last = lastRead[msg.h] ?? 0;
    if (msg.ts <= last) continue;
    const entry = byChannel.get(msg.h) ?? { count: 0, mention: false };
    entry.count += 1;
    if (msg.mention) entry.mention = true;
    byChannel.set(msg.h, entry);
  }
  return byChannel;
}

export function useReadState(): {
  unread: Map<string, ChannelUnread>;
  /** Latest tracked message timestamp per channel (unix secs, 0 = none seen). */
  latestTs: Map<string, number>;
} {
  const { connection, connectionState, identity } = useRelay();
  const myPubkey = identity?.pubkey;
  const messagesRef = useRef(new Map<string, TrackedMessage>());
  const [tick, setTick] = useState(0);

  // Recompute when marks fire from anywhere (e.g. ChannelView, mark-unread).
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

  const latestTs = useMemo(() => {
    const map = new Map<string, number>();
    for (const msg of messagesRef.current.values()) {
      if ((map.get(msg.h) ?? 0) < msg.ts) map.set(msg.h, msg.ts);
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  const unread = useMemo(
    () => computeUnreadMap(messagesRef.current.values(), forcedMap, lastReadMap),
    // tick bumps on every tracked event, markChannelRead, and reset.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tick],
  );

  return { unread, latestTs };
}
