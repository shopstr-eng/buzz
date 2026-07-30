/**
 * Team snapshot (.team.json) parse — mirrors the desktop contract
 * (desktop/src-tauri/src/managed_agents/team_snapshot.rs, `buzz-team-snapshot v1`):
 *   { "format": "buzz-team-snapshot", "version": 1,
 *     "team": { name, description?, instructions? },
 *     "members": [ AgentSnapshot, ... ] }
 *
 * Each member reuses the agent-snapshot contract, so per-member validation is
 * shared with agent-snapshot.ts (validateSnapshotObject) — the same rules
 * desktop single-sources via validate_snapshot + the memory-consistency
 * invariant. Import always mints a NEW team (fresh id) with freshly-slugged
 * member personas — a snapshot never overwrites existing directory entries.
 */

import {
  MAX_SNAPSHOT_JSON_BYTES,
  validateSnapshotObject,
  type AgentSnapshot,
} from "./agent-snapshot";

export const TEAM_SNAPSHOT_FORMAT = "buzz-team-snapshot";
export const TEAM_SNAPSHOT_VERSION = 1;

export interface TeamSnapshotMeta {
  name: string;
  description?: string;
  instructions?: string;
}

export interface TeamSnapshot {
  format: string;
  version: number;
  team: TeamSnapshotMeta;
  members: AgentSnapshot[];
}

export type TeamSnapshotParseResult =
  | { ok: true; snapshot: TeamSnapshot }
  | { ok: false; error: string };

function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

/** Import: validate raw .team.json text against the desktop contract. */
export function parseTeamSnapshot(jsonText: string): TeamSnapshotParseResult {
  if (byteLength(jsonText) > MAX_SNAPSHOT_JSON_BYTES) {
    return { ok: false, error: "Team snapshot file exceeds the 5 MiB limit." };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return { ok: false, error: "File is not valid JSON." };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "File is not a team snapshot object." };
  }
  const s = parsed as Record<string, unknown>;
  if (s.format !== TEAM_SNAPSHOT_FORMAT) {
    return { ok: false, error: "Not a buzz team snapshot (format mismatch)." };
  }
  if (s.version !== TEAM_SNAPSHOT_VERSION) {
    return {
      ok: false,
      error: `Unsupported team snapshot version (expected ${TEAM_SNAPSHOT_VERSION}).`,
    };
  }
  const team = s.team;
  if (!team || typeof team !== "object" || Array.isArray(team)) {
    return { ok: false, error: "Team snapshot is missing its team metadata." };
  }
  const name = (team as Record<string, unknown>).name;
  if (typeof name !== "string" || !name.trim()) {
    return { ok: false, error: "Team snapshot has no team name." };
  }
  const members = s.members;
  if (!Array.isArray(members) || members.length === 0) {
    return { ok: false, error: "Team snapshot must have at least one member." };
  }
  for (let i = 0; i < members.length; i++) {
    const result = validateSnapshotObject(members[i]);
    if (!result.ok) {
      return { ok: false, error: `Team member ${i + 1} is invalid: ${result.error}` };
    }
  }
  return { ok: true, snapshot: s as unknown as TeamSnapshot };
}
