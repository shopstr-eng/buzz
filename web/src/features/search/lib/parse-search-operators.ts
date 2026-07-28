/**
 * Parse Slack-style search operators out of a free-text query.
 *
 * Ported verbatim from desktop/src/features/search/lib/parseSearchOperators.ts
 * (upstream merge) so web and desktop accept the same query syntax:
 *   from:<pubkey|@handle>  in:<channelId|#name>  after:YYYY-MM-DD  before:YYYY-MM-DD
 *
 * Remaining text is the FTS / prefix query. Invalid operator tokens (for example
 * `after:yesterday`) are left in the text so they still participate in FTS.
 *
 * Operators must start at a token boundary (start of string or whitespace). A
 * word-boundary `\b` is intentionally avoided: it also matches after `-` / `/`,
 * which would turn `built-in:react` or `https://x.com/in:foo` into operators.
 */

export type ParsedSearchOperators = {
  /** FTS / prefix query with operators removed. */
  text: string;
  /** Raw `from:` value (pubkey hex, npub, @name, …), if present. */
  from: string | null;
  /** Raw `in:` value (channel uuid, #name, …), if present. */
  in: string | null;
  /**
   * `after:YYYY-MM-DD` → unix seconds at local start of that day (inclusive).
   * Messages at or after this timestamp match.
   */
  since: number | null;
  /**
   * `before:YYYY-MM-DD` → one second before local start of that day, because
   * NIP-01 `until` is an *inclusive* upper bound. Messages strictly before
   * local midnight match, so the named calendar day itself is not included
   * (Slack-compatible).
   */
  until: number | null;
};

/** Token-start only — not `\b`, which fires after hyphens and slashes. */
const OPERATOR_RE = /(?:^|\s)(from|in|after|before):(\S+)/gi;

function parseLocalDayStart(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return Math.floor(date.getTime() / 1000);
}

/** Drop trailing punctuation so `in:general,` still resolves to `general`. */
function cleanOperatorValue(value: string): string {
  return value.replace(/[.,;:!?]+$/g, "");
}

/**
 * Extract `from:` / `in:` / `after:` / `before:` operators from `raw`.
 *
 * Later occurrences of the same operator win. Date operators that are not
 * `YYYY-MM-DD` stay in the returned `text`.
 *
 * Multi-word handles (`from:@Will Pfleger`) are a known limitation: only the
 * first whitespace-delimited token is captured.
 */
export function parseSearchOperators(raw: string): ParsedSearchOperators {
  let from: string | null = null;
  let inValue: string | null = null;
  let since: number | null = null;
  let until: number | null = null;

  const kept: string[] = [];
  let lastIndex = 0;

  for (const match of raw.matchAll(OPERATOR_RE)) {
    const index = match.index ?? 0;
    kept.push(raw.slice(lastIndex, index));
    lastIndex = index + match[0].length;

    const kind = match[1].toLowerCase();
    const value = cleanOperatorValue(match[2]);

    if (kind === "from") {
      from = value;
      continue;
    }
    if (kind === "in") {
      inValue = value;
      continue;
    }
    if (kind === "after") {
      const parsed = parseLocalDayStart(value);
      if (parsed === null) {
        kept.push(match[0]);
      } else {
        since = parsed;
      }
      continue;
    }
    if (kind === "before") {
      const parsed = parseLocalDayStart(value);
      if (parsed === null) {
        kept.push(match[0]);
      } else {
        // NIP-01 `until` is inclusive, so step back one second to keep
        // `before:` exclusive of the named day's midnight.
        until = parsed - 1;
      }
    }
  }

  kept.push(raw.slice(lastIndex));

  return {
    text: kept.join("").replace(/\s+/g, " ").trim(),
    from,
    in: inValue,
    since,
    until,
  };
}

const HEX_PUBKEY_RE = /^[0-9a-f]{64}$/i;

/** True when `value` is a 64-char hex pubkey. */
export function isHexPubkey(value: string): boolean {
  return HEX_PUBKEY_RE.test(value);
}
