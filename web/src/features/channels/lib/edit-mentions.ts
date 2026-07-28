/**
 * Mention extraction + diffing for message edits, mirroring the desktop's
 * diffAddedMentionPubkeys (threading.ts): a kind 40003 edit re-emits p-tags
 * ONLY for mentions that were not present in the original body — a typo-fix
 * edit re-notifies nobody.
 */

/**
 * Resolve `@name` tokens in message text to pubkeys via a case-insensitive
 * name→pubkey map. Longest name wins so "Alice A." matches before "Alice"
 * when the text continues with more name characters.
 */
export function extractMentionPubkeys(
  content: string,
  nameToPubkey: Map<string, string>,
): Set<string> {
  const found = new Set<string>();
  if (!content.includes("@")) return found;

  // Sort names longest-first for greedy matching.
  const names = [...nameToPubkey.keys()].sort((a, b) => b.length - a.length);
  const lower = content.toLowerCase();
  let i = 0;
  while ((i = lower.indexOf("@", i)) !== -1) {
    const rest = lower.slice(i + 1);
    for (const name of names) {
      if (!name || !rest.startsWith(name)) continue;
      // Require a word boundary after the name (end, space, or punctuation)
      // so "@alice" doesn't match "Alice A." mid-token.
      const next = rest[name.length];
      if (next !== undefined && /[a-z0-9_]/.test(next)) continue;
      const pk = nameToPubkey.get(name);
      if (pk) found.add(pk);
      break;
    }
    i += 1;
  }
  return found;
}

/** Mentions in `final` that were not in `original`, excluding the editor. */
export function diffAddedMentionPubkeys(
  original: Set<string>,
  final: Set<string>,
  selfPubkey?: string,
): string[] {
  return [...final].filter((pk) => !original.has(pk) && pk !== selfPubkey);
}
