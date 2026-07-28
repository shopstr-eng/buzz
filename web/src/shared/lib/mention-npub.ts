/**
 * Helpers for resolving nostr:npub1… mention tokens to pubkeys/profile names.
 * Bech32 is canonically lowercase, but users can paste mixed/uppercase tokens
 * and our content regex matches case-insensitively — so every token is
 * lowercased before decoding or map lookup (mentionNames is keyed by
 * nip19.npubEncode output, which is always lowercase).
 */

import { nip19 } from "nostr-tools";

/** Regex matching nostr:npub1… tokens in message content (case-insensitive). */
export const NPUB_MENTION_RE = /nostr:(npub1[a-z0-9]+)/gi;

/** Decode a mention token to a hex pubkey; null when invalid. */
export function pubkeyFromNpubToken(token: string): string | null {
  try {
    const decoded = nip19.decode(token.toLowerCase());
    return decoded.type === "npub" ? (decoded.data as string) : null;
  } catch {
    return null;
  }
}

/** Canonical mentionNames lookup key for a matched token. */
export function canonicalNpubKey(token: string): string {
  return token.toLowerCase();
}
