/**
 * Agent snapshot (.agent.json) build/parse — mirrors the desktop contract
 * (desktop/src-tauri/src/managed_agents/agent_snapshot.rs):
 *   { "format": "buzz-agent-snapshot", "version": 1,
 *     "definition": { name, systemPrompt, runtime?, model?, provider?,
 *                     parallelism?, respondTo?, respondToAllowlist?, namePool?,
 *                     idleTimeoutSeconds?, maxTurnDurationSeconds? },
 *     "profile": { displayName, about?, avatarDataUrl?, avatarUrl? },
 *     "memory": { level: "none"|"core"|"everything", entries: [...] } }
 *
 * Portability: secrets (nsec, authTag, envVars), machine-local commands and
 * lineage ids are NEVER included. Import always mints a fresh identity —
 * the web persona d-tag (slug) is regenerated via ensureUniqueSlug by the
 * caller, so a snapshot never overwrites an existing persona.
 */

import type { AgentPersona } from "../use-agents";
import type { PersonaFormInput, RespondTo } from "../agent-events";

export const SNAPSHOT_FORMAT = "buzz-agent-snapshot";
export const SNAPSHOT_VERSION = 1;
/** Desktop: MAX_SNAPSHOT_JSON_BYTES. */
export const MAX_SNAPSHOT_JSON_BYTES = 5 * 1024 * 1024;
/** Desktop: MAX_AVATAR_INLINE_BYTES — data URLs larger than this export as URLs. */
export const MAX_AVATAR_INLINE_BYTES = 2 * 1024 * 1024;

export interface SnapshotDefinition {
  name: string;
  systemPrompt: string;
  runtime?: string;
  model?: string;
  provider?: string;
  parallelism?: number;
  respondTo?: string;
  respondToAllowlist?: string[];
  namePool?: string[];
  /**
   * Portable source classification (upstream #2439). Import-preview metadata
   * only — it NEVER grants built-in status; imports always mint custom
   * agents with fresh identities, matching the desktop always-mint rule.
   */
  sourceIsBuiltin?: boolean;
}

export interface SnapshotProfile {
  displayName: string;
  about?: string;
  avatarDataUrl?: string;
  avatarUrl?: string;
}

export interface AgentSnapshot {
  format: string;
  version: number;
  definition: SnapshotDefinition;
  profile: SnapshotProfile;
  memory: { level: string; entries: unknown[] };
}

function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

/** Export: build a portable snapshot from a directory persona. */
export function buildSnapshot(persona: AgentPersona): AgentSnapshot {
  const definition: SnapshotDefinition = {
    name: persona.displayName,
    systemPrompt: persona.systemPrompt,
    // Web personas are never built-in; desktop persona exports hardcode the
    // same false (personas/snapshot.rs).
    sourceIsBuiltin: false,
  };
  if (persona.runtime) definition.runtime = persona.runtime;
  if (persona.model) definition.model = persona.model;
  if (persona.provider) definition.provider = persona.provider;
  if (persona.parallelism && persona.parallelism > 1) definition.parallelism = persona.parallelism;
  if (persona.respondTo) definition.respondTo = persona.respondTo;
  if (persona.respondToAllowlist.length) definition.respondToAllowlist = persona.respondToAllowlist;
  if (persona.namePool.length) definition.namePool = persona.namePool;

  const profile: SnapshotProfile = { displayName: persona.displayName };
  if (persona.avatarUrl) {
    if (persona.avatarUrl.startsWith("data:") && byteLength(persona.avatarUrl) <= MAX_AVATAR_INLINE_BYTES) {
      profile.avatarDataUrl = persona.avatarUrl;
    } else {
      profile.avatarUrl = persona.avatarUrl;
    }
  }

  // Web personas carry no engrams; memory round-trips as an empty "none" block.
  return {
    format: SNAPSHOT_FORMAT,
    version: SNAPSHOT_VERSION,
    definition,
    profile,
    memory: { level: "none", entries: [] },
  };
}

export type SnapshotParseResult =
  | { ok: true; snapshot: AgentSnapshot }
  | { ok: false; error: string };

/** Import: validate raw file text against the desktop contract. */
export function parseSnapshot(jsonText: string): SnapshotParseResult {
  if (byteLength(jsonText) > MAX_SNAPSHOT_JSON_BYTES) {
    return { ok: false, error: "Snapshot file exceeds the 5 MiB limit." };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return { ok: false, error: "File is not valid JSON." };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "File is not a snapshot object." };
  }
  const s = parsed as Record<string, unknown>;
  if (s.format !== SNAPSHOT_FORMAT) {
    return { ok: false, error: "Not a buzz agent snapshot (format mismatch)." };
  }
  if (s.version !== SNAPSHOT_VERSION) {
    return { ok: false, error: `Unsupported snapshot version (expected ${SNAPSHOT_VERSION}).` };
  }
  const def = s.definition;
  if (!def || typeof def !== "object" || Array.isArray(def)) {
    return { ok: false, error: "Snapshot is missing its definition." };
  }
  const prof = s.profile;
  if (!prof || typeof prof !== "object" || Array.isArray(prof)) {
    return { ok: false, error: "Snapshot is missing its profile." };
  }
  const defName = (def as Record<string, unknown>).name;
  if (typeof defName !== "string" || !defName.trim()) {
    return { ok: false, error: "Snapshot definition has no name." };
  }
  const displayName = (prof as Record<string, unknown>).displayName;
  if (typeof displayName !== "string" || !displayName.trim()) {
    return { ok: false, error: "Snapshot profile has no display name." };
  }
  const mem = s.memory;
  if (mem && typeof mem === "object" && !Array.isArray(mem)) {
    const level = (mem as Record<string, unknown>).level;
    if (level !== "none" && level !== "core" && level !== "everything") {
      return { ok: false, error: "Snapshot has an unknown memory level." };
    }
    const entries = (mem as Record<string, unknown>).entries;
    if (level === "none" && Array.isArray(entries) && entries.length > 0) {
      return { ok: false, error: "Memory level 'none' must not carry entries." };
    }
  }
  return { ok: true, snapshot: s as unknown as AgentSnapshot };
}

const RESPOND_TO_VALUES: readonly RespondTo[] = ["owner-only", "allowlist", "anyone"];

function optStr(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/** Map a validated snapshot into the persona form input for publishing. */
export function snapshotToPersonaInput(snapshot: AgentSnapshot): PersonaFormInput {
  const d = snapshot.definition;
  const p = snapshot.profile;
  const respondTo = RESPOND_TO_VALUES.includes(d.respondTo as RespondTo)
    ? (d.respondTo as RespondTo)
    : "owner-only";
  const parallelism =
    typeof d.parallelism === "number" && d.parallelism > 1
      ? Math.floor(d.parallelism)
      : undefined;
  return {
    displayName: p.displayName.trim(),
    systemPrompt: typeof d.systemPrompt === "string" ? d.systemPrompt : "",
    avatarUrl: p.avatarDataUrl ?? optStr(p.avatarUrl),
    runtime: optStr(d.runtime),
    model: optStr(d.model),
    provider: optStr(d.provider),
    respondTo,
    respondToAllowlist: strList(d.respondToAllowlist).length
      ? strList(d.respondToAllowlist)
      : undefined,
    parallelism,
    namePool: strList(d.namePool).length ? strList(d.namePool) : undefined,
    // Imports land owner-private; sharing to the community catalog is an
    // explicit later action in the edit dialog.
    shared: false,
  };
}
