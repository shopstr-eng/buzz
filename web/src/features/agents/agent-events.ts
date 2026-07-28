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

function opt(payload: Record<string, unknown>, key: string, value: string | undefined): void {
  const v = value?.trim();
  if (v) payload[key] = v;
}

export function buildPersonaEvent(
  input: PersonaFormInput,
  slug: string,
  now: number,
): UnsignedNostrEvent {
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
}

export function buildManagedAgentEvent(
  input: ManagedAgentFormInput,
  agentPubkey: string,
  now: number,
): UnsignedNostrEvent {
  const payload: Record<string, unknown> = {
    name: input.name.trim(),
    parallelism: input.parallelism,
    respond_to: input.respondTo,
  };
  if (input.personaId) {
    payload.persona_id = input.personaId;
  } else {
    opt(payload, "system_prompt", input.systemPrompt);
    opt(payload, "model", input.model);
    opt(payload, "provider", input.provider);
  }
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
