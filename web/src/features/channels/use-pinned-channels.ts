/**
 * Pinned/starred channels (web-local v1).
 *
 * The desktop stores pins/stars/sections in kind:30078 NIP-78 app data with
 * its own (encrypted) scheme; cross-client sync is a follow-up. For now pins
 * live in localStorage and pinned channels sort into their own sidebar section.
 */

import { useEffect, useState } from "react";

const LS_KEY = "buzz.pinnedChannels.v1";

function load(): string[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as string[];
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === "string") : [];
  } catch {
    return [];
  }
}

let pinnedList: string[] = load();
const listeners = new Set<() => void>();

function emit() {
  for (const fn of listeners) fn();
}

export function togglePinnedChannel(groupId: string): void {
  pinnedList = pinnedList.includes(groupId)
    ? pinnedList.filter((id) => id !== groupId)
    : [...pinnedList, groupId];
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(pinnedList));
  } catch {
    // quota — non-fatal
  }
  emit();
}

export function usePinnedChannels(): {
  pinned: Set<string>;
  togglePin: (groupId: string) => void;
} {
  const [, setTick] = useState(0);

  useEffect(() => {
    const fn = () => setTick((t) => t + 1);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);

  return { pinned: new Set(pinnedList), togglePin: togglePinnedChannel };
}
