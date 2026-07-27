/**
 * Community custom-emoji palette (NIP-30, kind:30030).
 *
 * Mirrors the desktop client: the palette is the UNION of every member's own
 * kind:30030 set with d-tag `buzz:custom-emoji`. Each set carries
 * ["emoji", shortcode, imageUrl] tags. Custom emoji are referenced in message
 * content and reactions as `:shortcode:`; reaction events carry the
 * ["emoji", shortcode, url] tag so other clients can resolve the image.
 */

import { useEffect, useMemo, useState } from "react";
import { useRelay } from "@/shared/context/relay-context";
import type { NostrEvent } from "@/shared/lib/relay-connection";

export const KIND_EMOJI_SET = 30030;
export const CUSTOM_EMOJI_SET_D_TAG = "buzz:custom-emoji";

export interface CustomEmoji {
  shortcode: string;
  url: string;
}

function normalizeShortcode(raw: string): string {
  return raw
    .trim()
    .replace(/^:+|:+$/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_+-]/g, "");
}

/** Parse NIP-30 ["emoji", shortcode, url] tags (first wins per shortcode). */
function customEmojiFromEvent(ev: NostrEvent): CustomEmoji[] {
  const seen = new Set<string>();
  const out: CustomEmoji[] = [];
  for (const tag of ev.tags) {
    if (tag[0] !== "emoji") continue;
    const shortcode = normalizeShortcode(tag[1] ?? "");
    const url = tag[2] ?? "";
    if (!shortcode || !url || seen.has(shortcode)) continue;
    seen.add(shortcode);
    out.push({ shortcode, url });
  }
  return out;
}

export function useCustomEmoji(): {
  customEmoji: CustomEmoji[];
  /** shortcode → image URL, for rendering `:shortcode:` tokens */
  customEmojiUrls: Map<string, string>;
} {
  const { connection, connectionState } = useRelay();
  /** pubkey → that member's latest set (union across members) */
  const [sets, setSets] = useState<Map<string, { createdAt: number; emoji: CustomEmoji[] }>>(
    new Map(),
  );

  useEffect(() => {
    if (!connection || connectionState !== "ready") return;
    setSets(new Map());

    const unsub = connection.subscribe(
      { kinds: [KIND_EMOJI_SET], "#d": [CUSTOM_EMOJI_SET_D_TAG], limit: 500 },
      (ev: NostrEvent) => {
        setSets((prev) => {
          const existing = prev.get(ev.pubkey);
          if (existing && existing.createdAt >= ev.created_at) return prev;
          const next = new Map(prev);
          next.set(ev.pubkey, {
            createdAt: ev.created_at,
            emoji: customEmojiFromEvent(ev),
          });
          return next;
        });
      },
    );

    return unsub;
  }, [connection, connectionState]);

  const customEmoji = useMemo(() => {
    const byShortcode = new Map<string, string>();
    // Newest set wins on shortcode conflicts.
    const ordered = [...sets.values()].sort((a, b) => a.createdAt - b.createdAt);
    for (const set of ordered) {
      for (const e of set.emoji) byShortcode.set(e.shortcode, e.url);
    }
    return [...byShortcode.entries()].map(([shortcode, url]) => ({ shortcode, url }));
  }, [sets]);

  const customEmojiUrls = useMemo(
    () => new Map(customEmoji.map((e) => [e.shortcode, e.url])),
    [customEmoji],
  );

  return { customEmoji, customEmojiUrls };
}
