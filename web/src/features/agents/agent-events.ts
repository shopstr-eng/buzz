/**
 * Builders for owner-authored agent directory events (kinds 30175 persona,
 * 30176 team, 30177 managed agent) plus their kind-5 deletions.
 *
 * The payload/tag shapes mirror the desktop write contract byte-for-byte
 * (desktop/src-tauri/src/managed_agents/persona_events.rs, team_events.rs,
 * agent_events.rs) so web-published records are indistinguishable from
 * desktop-published ones and both clients read each other's data.
 *
 * Pure functions — `now` is injected for deterministic tests.
 */

import type { UnsignedNostrEvent } from "@/shared/lib/nostr-signer";
import { KIND_PERSONA, KIND_TEAM, KIND_MANAGED_AGENT } from "./use-agents";
import { KIND_TEAM_CATALOG, TEAM_CATALOG_CONTENT_VERSION } from "./lib/team-catalog";

export type RespondTo = "owner-only" | "allowlist" | "anyone";

/** Desktop slug grammar for persona d-tags. */
export const PERSONA_SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export function slugifyPersonaName(name: string): string {
  const s = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/[-_]{2,}/g, "-")
    .replace(/^[-_]+/, "")
    .replace(/[-_]+$/, "")
    .slice(0, 64)
    .replace(/[-_]+$/, "");
  return PERSONA_SLUG_RE.test(s) ? s : "persona";
}

/** Append `-2`, `-3`, … until the slug is free (d-tags replace, so collisions destroy data). */
export function ensureUniqueSlug(base: string, taken: string[]): string {
  if (!taken.includes(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base.slice(0, 60).replace(/[-_]+$/, "")}-${i}`;
    if (PERSONA_SLUG_RE.test(candidate) && !taken.includes(candidate)) return candidate;
  }
}

export interface PersonaFormInput {
  displayName: string;
  systemPrompt: string;
  avatarUrl?: string;
  runtime?: string;
  model?: string;
  provider?: string;
  respondTo: RespondTo;
  respondToAllowlist?: string[];
  parallelism?: number;
  /** Desktop-contract field; preserved verbatim across web edits. */
  namePool?: string[];
  /** Adds ["shared","true"] — the relay then fans the persona out community-wide (agent catalog). */
  shared: boolean;
}

/**
 * Map a stored persona back to the form input used when republishing it —
 * e.g. the catalog share toggle, which flips `shared` and republishes the
 * FULL record. Every persona field the write contract carries must survive
 * this mapping verbatim, or toggling share would silently strip
 * desktop-authored settings (name_pool, parallelism, allowlist, …).
 */
export function personaToFormInput(
  persona: {
    displayName: string;
    systemPrompt: string;
    avatarUrl: string | null;
    runtime: string | null;
    model: string | null;
    provider: string | null;
    respondTo: string | null;
    respondToAllowlist: string[];
    parallelism: number | null;
    namePool: string[];
  },
  shared: boolean,
): PersonaFormInput {
  return {
    displayName: persona.displayName,
    systemPrompt: persona.systemPrompt,
    avatarUrl: persona.avatarUrl ?? undefined,
    runtime: persona.runtime ?? undefined,
    model: persona.model ?? undefined,
    provider: persona.provider ?? undefined,
    respondTo: (persona.respondTo as RespondTo | null) ?? "anyone",
    respondToAllowlist: persona.respondToAllowlist,
    parallelism: persona.parallelism ?? undefined,
    namePool: persona.namePool,
    shared,
  };
}

function opt(payload: Record<string, unknown>, key: string, value: string | undefined): void {
  const v = value?.trim();
  if (v) payload[key] = v;
}

export function buildPersonaEvent(
  input: PersonaFormInput,
  slug: string,
  now: number,
): UnsignedNostrEvent {
  // KEY ORDER IS PART OF THE CONTRACT: keys mirror desktop's
  // PersonaEventContent struct order (display_name, system_prompt,
  // avatar_url, runtime, model, provider, name_pool, respond_to,
  // respond_to_allowlist, parallelism) because desktop suppresses
  // republishes by comparing raw content bytes. Do not reorder.
  const payload: Record<string, unknown> = {
    display_name: input.displayName.trim(),
    system_prompt: input.systemPrompt,
  };
  opt(payload, "avatar_url", input.avatarUrl);
  opt(payload, "runtime", input.runtime);
  opt(payload, "model", input.model);
  opt(payload, "provider", input.provider);
  if (input.namePool?.length) payload.name_pool = input.namePool;
  payload.respond_to = input.respondTo;
  if (input.respondToAllowlist?.length) payload.respond_to_allowlist = input.respondToAllowlist;
  if (input.parallelism && input.parallelism > 1) payload.parallelism = input.parallelism;

  const tags: string[][] = [["d", slug]];
  if (input.shared) tags.push(["shared", "true"]);

  return {
    kind: KIND_PERSONA,
    created_at: now,
    tags,
    content: JSON.stringify(payload),
  };
}

export interface TeamFormInput {
  name: string;
  description?: string;
  instructions?: string;
  personaIds: string[];
}

export function buildTeamEvent(
  input: TeamFormInput,
  teamId: string,
  now: number,
): UnsignedNostrEvent {
  const payload: Record<string, unknown> = { name: input.name.trim() };
  opt(payload, "description", input.description);
  // Tri-state per desktop contract: explicit null when absent.
  const instructions = input.instructions?.trim();
  payload.instructions = instructions ? instructions : null;
  payload.persona_ids = input.personaIds;

  return {
    kind: KIND_TEAM,
    created_at: now,
    tags: [["d", teamId]],
    content: JSON.stringify(payload),
  };
}

/**
 * Fields a team-catalog member projection is built FROM — the persona's
 * stored definition fields. respond_to_allowlist is deliberately absent
 * from the output projection (sanitization contract), and "allowlist"
 * respond_to downgrades to "owner-only" (a copy has no allowlist context).
 */
export interface TeamCatalogMemberSource {
  displayName: string;
  systemPrompt: string;
  avatarUrl: string | null;
  runtime: string | null;
  model: string | null;
  provider: string | null;
  namePool: string[];
  respondTo: string | null;
  parallelism: number | null;
}

/** Build one sanitized member projection object (snake_case wire schema). */
function buildTeamCatalogMember(member: TeamCatalogMemberSource): Record<string, unknown> {
  // Same key order as the persona content contract (display_name,
  // system_prompt, avatar_url, runtime, model, provider, name_pool,
  // respond_to, parallelism) — and NEVER respond_to_allowlist or any
  // secret-bearing field: the projection is community-readable plaintext.
  const m: Record<string, unknown> = {
    display_name: member.displayName.trim(),
    system_prompt: member.systemPrompt,
  };
  opt(m, "avatar_url", member.avatarUrl ?? undefined);
  opt(m, "runtime", member.runtime ?? undefined);
  opt(m, "model", member.model ?? undefined);
  opt(m, "provider", member.provider ?? undefined);
  if (member.namePool.length) m.name_pool = member.namePool;
  const respondTo = member.respondTo === "allowlist" ? "owner-only" : member.respondTo;
  if (respondTo === "owner-only" || respondTo === "anyone") m.respond_to = respondTo;
  if (member.parallelism && member.parallelism > 1) m.parallelism = member.parallelism;
  return m;
}

/**
 * Build the kind:30178 team-catalog projection (NIP-AP): the owner-authored,
 * shareable snapshot of a team with EMBEDDED sanitized member projections.
 * `shared: true` adds the exact ["shared","true"] tag (community-readable);
 * `shared: false` republishes the head WITHOUT the tag — that is unsharing,
 * which retracts the projection from foreign readers (NIP-33 newest wins).
 */
export function buildTeamCatalogEvent(
  team: { name: string; description?: string | null; instructions?: string | null },
  members: TeamCatalogMemberSource[],
  teamId: string,
  shared: boolean,
  now: number,
): UnsignedNostrEvent {
  // Versioned body: { v: 1, name, description?, instructions?, members }.
  const payload: Record<string, unknown> = {
    v: TEAM_CATALOG_CONTENT_VERSION,
    name: team.name.trim(),
  };
  opt(payload, "description", team.description ?? undefined);
  opt(payload, "instructions", team.instructions ?? undefined);
  payload.members = members.map(buildTeamCatalogMember);

  // Envelope per NIP-AP: exactly one non-empty d tag (the team id — UUIDs
  // and builtin-team:* ids are legal here) and, when sharing, the exact
  // two-element ["shared","true"] tag shape the relay enforces.
  const tags: string[][] = [["d", teamId]];
  if (shared) tags.push(["shared", "true"]);

  return {
    kind: KIND_TEAM_CATALOG,
    created_at: now,
    tags,
    content: JSON.stringify(payload),
  };
}

/** Structural deep-equal for JSON values (key order insensitive, array order sensitive). */
function jsonDeepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => jsonDeepEqual(v, b[i]));
  }
  if (
    typeof a === "object" && a !== null && !Array.isArray(a) &&
    typeof b === "object" && b !== null && !Array.isArray(b)
  ) {
    const ka = Object.keys(a as Record<string, unknown>);
    const kb = Object.keys(b as Record<string, unknown>);
    if (ka.length !== kb.length) return false;
    return ka.every((k) =>
      jsonDeepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
    );
  }
  return false;
}

/**
 * True when the published kind:30178 head content no longer matches the
 * projection we would publish NOW from the current team + member personas —
 * i.e. the shared snapshot has gone stale after edits. Comparison is
 * structural (key-order insensitive) so byte-level serializer differences
 * between clients never produce false "stale" flags. Unparseable published
 * content counts as stale (re-sharing repairs it).
 */
export function teamCatalogSnapshotIsStale(
  publishedContent: string,
  team: { name: string; description?: string | null; instructions?: string | null },
  members: TeamCatalogMemberSource[],
): boolean {
  let published: unknown;
  try {
    published = JSON.parse(publishedContent);
  } catch {
    return true;
  }
  const expected = JSON.parse(
    buildTeamCatalogEvent(team, members, "stale-check", true, 0).content,
  ) as unknown;
  return !jsonDeepEqual(expected, published);
}

export interface ManagedAgentFormInput {
  name: string;
  /** When set, runtime config resolves through the persona — inline fields are omitted ("slimming"). */
  personaId?: string;
  systemPrompt?: string;
  model?: string;
  provider?: string;
  respondTo: RespondTo;
  respondToAllowlist?: string[];
  parallelism: number;
  /** Desktop-contract drift indicator; preserved verbatim across web edits (standalone only). */
  personaSourceVersion?: string;
}

/**
 * Map a stored managed agent (kind 30177) back to the form input used when
 * republishing it. Mirrors personaToFormInput: an edit replaces the FULL
 * record, so every write-contract field must survive this mapping verbatim
 * or a web edit would silently reset desktop-authored settings
 * (respond_to_allowlist, parallelism, persona link, …).
 */
export function agentToFormInput(agent: {
  name: string | null;
  personaId: string | null;
  systemPrompt: string | null;
  model: string | null;
  provider: string | null;
  respondTo: string | null;
  respondToAllowlist: string[];
  parallelism: number | null;
  personaSourceVersion: string | null;
}): ManagedAgentFormInput {
  return {
    name: agent.name ?? "",
    personaId: agent.personaId ?? undefined,
    systemPrompt: agent.systemPrompt ?? undefined,
    model: agent.model ?? undefined,
    provider: agent.provider ?? undefined,
    respondTo: (agent.respondTo as RespondTo | null) ?? "owner-only",
    respondToAllowlist: agent.respondToAllowlist,
    parallelism: agent.parallelism ?? 1,
    personaSourceVersion: agent.personaSourceVersion ?? undefined,
  };
}

export function buildManagedAgentEvent(
  input: ManagedAgentFormInput,
  agentPubkey: string,
  now: number,
): UnsignedNostrEvent {
  // KEY ORDER IS PART OF THE CONTRACT: desktop's republish-suppression
  // (reconcile.rs retain_agent_record) compares raw content BYTES against
  // its own serde serialization of ManagedAgentEventContent. Keys must be
  // inserted in the exact desktop struct order (name, persona_id,
  // system_prompt, model, provider, persona_source_version, parallelism,
  // respond_to, respond_to_allowlist) or a value-identical web edit looks
  // "changed" and triggers a spurious desktop republish.
  const payload: Record<string, unknown> = {
    name: input.name.trim(),
  };
  if (input.personaId) {
    payload.persona_id = input.personaId;
  } else {
    opt(payload, "system_prompt", input.systemPrompt);
    opt(payload, "model", input.model);
    opt(payload, "provider", input.provider);
    // Slimming contract: definition-linked agents omit the quad including
    // persona_source_version; standalone agents keep it verbatim.
    opt(payload, "persona_source_version", input.personaSourceVersion);
  }
  payload.parallelism = input.parallelism;
  payload.respond_to = input.respondTo;
  if (input.respondToAllowlist?.length) payload.respond_to_allowlist = input.respondToAllowlist;

  return {
    kind: KIND_MANAGED_AGENT,
    created_at: now,
    tags: [["d", agentPubkey]],
    content: JSON.stringify(payload),
  };
}

/**
 * Deletion per desktop contract: kind 5 carrying only the address `a` tag
 * (`<kind>:<owner_pubkey>:<d_tag>`), no `e` tag, empty content.
 */
export function buildDirectoryDeleteEvent(
  kind: typeof KIND_PERSONA | typeof KIND_TEAM | typeof KIND_MANAGED_AGENT,
  ownerPubkey: string,
  dTag: string,
  now: number,
): UnsignedNostrEvent {
  return {
    kind: 5,
    created_at: now,
    tags: [["a", `${kind}:${ownerPubkey}:${dTag}`]],
    content: "",
  };
}

/**
 * Kind-5 deletion of a team's kind:30178 catalog projection (NIP-AP
 * "Deletion"): address a-tag `30178:<owner>:<team-id>` plus ["k","30178"].
 * Published alongside the team's own kind:30176 deletion so a deleted team
 * never lingers in the community catalog with stale member instructions.
 */
export function buildTeamCatalogDeleteEvent(
  ownerPubkey: string,
  teamId: string,
  now: number,
): UnsignedNostrEvent {
  return {
    kind: 5,
    created_at: now,
    tags: [
      ["a", `${KIND_TEAM_CATALOG}:${ownerPubkey}:${teamId}`],
      ["k", String(KIND_TEAM_CATALOG)],
    ],
    content: "",
  };
}
