/**
 * Pinned/starred channels with cross-client sync (kind:30078 "channel-stars"
 * slot, NIP-44 self-encrypted — desktop contract).
 *
 * The local module store stays the UI source of truth; use-sync-30078.ts
 * merges remote entries (LWW per channel by updatedAt ms) and publishes
 * local toggles. Pin decision timestamps persist in `buzz.pinTimes.v1` so
 * LWW survives reloads.
 */

import { useEffect, useState } from "react";
import type { PinEntry } from "./lib/pins-sync";

const LS_PINS = "buzz.pinnedChannels.v1";
const LS_TIMES = "buzz.pinTimes.v1";

function loadPinned(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(LS_PINS) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function loadTimes(): Record<string, number> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(LS_TIMES) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

let pinnedList: string[] = loadPinned();
let pinTimes: Record<string, number> = loadTimes();
const listeners = new Set<() => void>();

function persist(): void {
  try {
    localStorage.setItem(LS_PINS, JSON.stringify(pinnedList));
    localStorage.setItem(LS_TIMES, JSON.stringify(pinTimes));
  } catch {
    // quota — non-fatal
  }
}

function emit(): void {
  for (const fn of listeners) fn();
}

export function togglePinnedChannel(groupId: string): void {
  pinnedList = pinnedList.includes(groupId)
    ? pinnedList.filter((id) => id !== groupId)
    : [...pinnedList, groupId];
  pinTimes = { ...pinTimes, [groupId]: Date.now() };
  persist();
  emit();
}

/**
 * Remote merge entrypoint (LWW per channel by updatedAt). Applies remote
 * decisions newer than the local timestamp for that channel. Returns true
 * when the visible pin set changed.
 */
export function applyRemotePins(remote: Record<string, PinEntry>): boolean {
  let timesAdvanced = false;
  let changed = false;
  for (const [id, entry] of Object.entries(remote)) {
    if ((pinTimes[id] ?? 0) >= entry.updatedAt) continue;
    pinTimes = { ...pinTimes, [id]: entry.updatedAt };
    timesAdvanced = true;
    const isPinned = pinnedList.includes(id);
    if (entry.starred && !isPinned) pinnedList = [...pinnedList, id];
    else if (!entry.starred && isPinned) pinnedList = pinnedList.filter((x) => x !== id);
    else continue;
    changed = true;
  }
  // Persist whenever timestamps advanced — even without a visible change —
  // or a reload resurrects the stale local decision and breaks LWW.
  if (timesAdvanced) persist();
  if (changed) emit();
  return changed;
}

/** Snapshot for publishing: every channel with a known pin decision. */
export function getPinsSnapshot(): Record<string, PinEntry> {
  const out: Record<string, PinEntry> = {};
  const ids = new Set([...Object.keys(pinTimes), ...pinnedList]);
  for (const id of ids) {
    out[id] = { starred: pinnedList.includes(id), updatedAt: pinTimes[id] ?? 0 };
  }
  return out;
}

/** Subscribe to pin changes (returns unsubscribe). */
export function subscribePins(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function usePinnedChannels(): {
  pinned: Set<string>;
  togglePin: (groupId: string) => void;
} {
  const [, setTick] = useState(0);

  useEffect(() => subscribePins(() => setTick((t) => t + 1)), []);

  return { pinned: new Set(pinnedList), togglePin: togglePinnedChannel };
}
