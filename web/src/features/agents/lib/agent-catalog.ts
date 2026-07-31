/**
 * Community agent catalog (kind 30175 personas with exactly one
 * ["shared","true"] tag) — mirrors the desktop contract in
 * desktop/src/features/agents/lib/personaCatalogRelay.ts:
 * - Catalog membership is decided by the LATEST head per (author, d)
 *   coordinate; an unshared/invalid newest head hides older shared ones.
 * - respond_to "allowlist" downgrades to "owner-only" (a copy has no
 *   allowlist context from the original owner).
 * - Avatars: http(s) URLs, or inline percent-encoded SVG data URLs (≤8 KiB —
 *   emoji avatars); every other data: MIME is rejected.
 */

import type { NostrEvent } from "@/shared/lib/relay-connection";
import type { PersonaFormInput, RespondTo } from "../agent-events";

export const KIND_PERSONA = 30175;

/**
 * Sanitized persona definition fields as they appear in shared content —
 * shared between kind:30175 catalog personas and the embedded member
 * projections of kind:30178 team-catalog events (same JSON schema).
 */
export interface PersonaProjection {
  displayName: string;
  avatarUrl: string | null;
  systemPrompt: string;
  runtime: string | null;
  model: string | null;
  provider: string | null;
  namePool: string[];
  /** "allowlist" is downgraded to "owner-only" by the contract. */
  respondTo: "owner-only" | "anyone" | null;
  parallelism: number | null;
}

export interface CatalogPersona extends PersonaProjection {
  /** "<authorPubkey>:<dTag>" — dedupe/provenance key. */
  coordinate: string;
  authorPubkey: string;
  createdAt: number;
}

/** Exactly one ["shared","true"] tag — no more, no less. */
export function personaEventIsShared(ev: { tags: string[][] }): boolean {
  const sharedTags = ev.tags.filter((t) => t[0] === "shared");
  return sharedTags.length === 1 && sharedTags[0].length === 2 && sharedTags[0][1] === "true";
}

function isSafeHttpUrl(value: unknown): value is string {
  if (typeof value !== "string" || !value.length || value.length > 2048 || /[\s()]/u.test(value)) {
    return false;
  }
  try {
    const p = new URL(value);
    return p.protocol === "https:" || p.protocol === "http:";
  } catch {
    return false;
  }
}

const INLINE_SVG_AVATAR_PREFIX = "data:image/svg+xml,";
const MAX_INLINE_SVG_AVATAR_LENGTH = 8192;

function isInlineSvgAvatar(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.startsWith(INLINE_SVG_AVATAR_PREFIX) &&
    value.length <= MAX_INLINE_SVG_AVATAR_LENGTH
  );
}

function optStr(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Parse a sanitized persona-definition object (persona event content, or an
 * embedded team-catalog member projection — same schema) into its fields.
 * Returns null when the object has no usable display_name.
 */
export function parsePersonaProjection(parsed: unknown): PersonaProjection | null {
  if (!isObject(parsed) || typeof parsed.display_name !== "string" || !parsed.display_name.trim()) {
    return null;
  }
  const avatarUrl =
    isSafeHttpUrl(parsed.avatar_url) || isInlineSvgAvatar(parsed.avatar_url)
      ? (parsed.avatar_url as string)
      : null;
  const respondTo =
    parsed.respond_to === "allowlist"
      ? "owner-only"
      : parsed.respond_to === "owner-only" || parsed.respond_to === "anyone"
        ? parsed.respond_to
        : null;
  const parallelism =
    typeof parsed.parallelism === "number" &&
    Number.isInteger(parsed.parallelism) &&
    parsed.parallelism >= 1 &&
    parsed.parallelism <= 32
      ? parsed.parallelism
      : null;
  return {
    displayName: parsed.display_name,
    avatarUrl,
    systemPrompt: typeof parsed.system_prompt === "string" ? parsed.system_prompt : "",
    runtime: optStr(parsed.runtime),
    model: optStr(parsed.model),
    provider: optStr(parsed.provider),
    namePool: Array.isArray(parsed.name_pool)
      ? parsed.name_pool.filter((c): c is string => typeof c === "string")
      : [],
    respondTo,
    parallelism,
  };
}

/** Parse one persona event into a catalog entry (shared check included). */
export function parseCatalogPersona(ev: NostrEvent): CatalogPersona | null {
  if (!personaEventIsShared(ev)) return null;
  const dTags = ev.tags.filter((t) => t[0] === "d" && typeof t[1] === "string");
  if (dTags.length !== 1) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(ev.content);
  } catch {
    return null;
  }
  const projection = parsePersonaProjection(parsed);
  if (!projection) return null;
  return {
    ...projection,
    coordinate: `${ev.pubkey}:${dTags[0][1]}`,
    authorPubkey: ev.pubkey,
    createdAt: ev.created_at,
  };
}

/**
 * Fold raw persona events to the latest head per (author, d) coordinate —
 * newest created_at wins, same-second ties go to the LARGER event id
 * (directory-store semantics) — then keep only valid shared heads.
 */
export function foldCatalogHeads(events: NostrEvent[]): CatalogPersona[] {
  const heads = new Map<string, NostrEvent>();
  for (const ev of events) {
    const d = ev.tags.find((t) => t[0] === "d")?.[1];
    if (!d) continue;
    const key = `${ev.pubkey}:${d}`;
    const existing = heads.get(key);
    if (
      !existing ||
      existing.created_at < ev.created_at ||
      (existing.created_at === ev.created_at && existing.id < ev.id)
    ) {
      heads.set(key, ev);
    }
  }
  const entries: CatalogPersona[] = [];
  for (const ev of heads.values()) {
    const entry = parseCatalogPersona(ev);
    if (entry) entries.push(entry);
  }
  return entries.sort((a, b) => b.createdAt - a.createdAt);
}

/** Map a catalog entry into the persona form input for "Add to my agents". */
export function catalogToPersonaInput(entry: CatalogPersona): PersonaFormInput {
  return {
    displayName: entry.displayName,
    systemPrompt: entry.systemPrompt,
    avatarUrl: entry.avatarUrl ?? undefined,
    runtime: entry.runtime ?? undefined,
    model: entry.model ?? undefined,
    provider: entry.provider ?? undefined,
    respondTo: (entry.respondTo ?? "owner-only") as RespondTo,
    parallelism: entry.parallelism && entry.parallelism > 1 ? entry.parallelism : undefined,
    namePool: entry.namePool.length ? entry.namePool : undefined,
    // Copies land owner-private; re-sharing is an explicit later action.
    shared: false,
  };
}

/* ------------------------------------------------------------------ */
/* Provenance: which catalog coordinates this browser already copied.  */
/* ------------------------------------------------------------------ */

const COPIES_KEY = "buzz.catalogCopies.v1";

export function loadCatalogCopies(): string[] {
  try {
    const raw = localStorage.getItem(COPIES_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function recordCatalogCopy(coordinate: string): string[] {
  const copies = loadCatalogCopies();
  if (!copies.includes(coordinate)) copies.push(coordinate);
  try {
    localStorage.setItem(COPIES_KEY, JSON.stringify(copies));
  } catch {
    // storage full/blocked — provenance degrades to this session
  }
  return copies;
}
