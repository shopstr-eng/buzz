/**
 * Shared team catalog (kind 30178 — NIP-AP "team catalog projection").
 * A 30178 event is the owner-authored, shareable projection of a team:
 * content is a versioned JSON body carrying sanitized team fields plus
 * ordered EMBEDDED member persona projections (so a foreign reader never
 * needs the members' private kind:30175 heads).
 *
 * Relay contract (docs/nips/NIP-AP.md):
 * - Read gate is server-side: foreign readers only ever receive heads whose
 *   tags contain exactly ["shared","true"]. There is no `#shared` REQ filter;
 *   like the persona catalog, the client pages the kind and re-checks the
 *   shared tag on the LATEST head per (author, d) — an unshared newest head
 *   hides older shared ones.
 * - The `d` tag is a team id (UUID or `builtin-team:*`), NOT a persona slug.
 * - Importing/sharing a team includes EVERY member's instructions, even
 *   members whose own personas are unshared — UI copy must say so.
 */

import type { NostrEvent } from "@/shared/lib/relay-connection";
import type { PersonaFormInput, RespondTo, TeamFormInput } from "../agent-events";
import {
  parsePersonaProjection,
  personaEventIsShared,
  type PersonaProjection,
} from "./agent-catalog";

export const KIND_TEAM_CATALOG = 30178;

/** Content schema version this client understands. */
export const TEAM_CATALOG_CONTENT_VERSION = 1;

export type CatalogTeamMember = PersonaProjection;

export interface CatalogTeam {
  /** "team/<authorPubkey>:<dTag>" — provenance key, disjoint from persona coordinates. */
  coordinate: string;
  authorPubkey: string;
  createdAt: number;
  name: string;
  /** Short tagline/description of the team (desktop `description` field). */
  tagline: string | null;
  instructions: string | null;
  /** Ordered embedded member projections; may be empty for a members-less team. */
  members: CatalogTeamMember[];
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function optStr(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/**
 * Parse one kind:30178 event into a catalog team (shared check included).
 * Body: { v: 1, name, description?|tagline?, instructions?, members: [...] }.
 * Members that fail persona-projection validation are dropped individually
 * (a bad member must not hide the whole team); a bad envelope drops the team.
 */
export function parseCatalogTeam(ev: NostrEvent): CatalogTeam | null {
  if (!personaEventIsShared(ev)) return null;
  const dTags = ev.tags.filter((t) => t[0] === "d" && typeof t[1] === "string" && t[1].length > 0);
  if (dTags.length !== 1) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(ev.content);
  } catch {
    return null;
  }
  if (!isObject(parsed)) return null;
  // Versioned body: reject bodies from a future major schema we can't read.
  if (typeof parsed.v === "number" && parsed.v > TEAM_CATALOG_CONTENT_VERSION) return null;
  if (typeof parsed.name !== "string" || !parsed.name.trim()) return null;
  const members: CatalogTeamMember[] = [];
  if (Array.isArray(parsed.members)) {
    for (const raw of parsed.members) {
      const member = parsePersonaProjection(raw);
      if (member) members.push(member);
    }
  }
  return {
    coordinate: `team/${ev.pubkey}:${dTags[0][1]}`,
    authorPubkey: ev.pubkey,
    createdAt: ev.created_at,
    name: parsed.name.trim(),
    tagline: optStr(parsed.tagline) ?? optStr(parsed.description),
    instructions: optStr(parsed.instructions),
    members,
  };
}

/**
 * Fold raw 30178 events to the latest head per (author, d) coordinate —
 * newest created_at wins, same-second ties go to the LARGER event id
 * (directory-store semantics) — then keep only valid shared heads.
 */
export function foldTeamCatalogHeads(events: NostrEvent[]): CatalogTeam[] {
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
  const entries: CatalogTeam[] = [];
  for (const ev of heads.values()) {
    const entry = parseCatalogTeam(ev);
    if (entry) entries.push(entry);
  }
  return entries.sort((a, b) => b.createdAt - a.createdAt);
}

/** Map an embedded member projection to the persona form input for import. */
export function catalogTeamMemberToPersonaInput(member: CatalogTeamMember): PersonaFormInput {
  return {
    displayName: member.displayName,
    systemPrompt: member.systemPrompt,
    avatarUrl: member.avatarUrl ?? undefined,
    runtime: member.runtime ?? undefined,
    model: member.model ?? undefined,
    provider: member.provider ?? undefined,
    respondTo: (member.respondTo ?? "owner-only") as RespondTo,
    parallelism: member.parallelism && member.parallelism > 1 ? member.parallelism : undefined,
    namePool: member.namePool.length ? member.namePool : undefined,
    // Copies land owner-private; re-sharing is an explicit later action.
    shared: false,
  };
}

/** Map a catalog team's own fields to the team form input (member ids added by the importer). */
export function catalogTeamToTeamInput(team: CatalogTeam, personaIds: string[]): TeamFormInput {
  return {
    name: team.name,
    description: team.tagline ?? undefined,
    instructions: team.instructions ?? undefined,
    personaIds,
  };
}
