/**
 * Agent directory: personas (kind 30175), teams (30176) and managed agent
 * instances (30177). These are owner-authored, addressable (`d` tag)
 * snapshots — published by the desktop app, admin console, or the web itself
 * (use-agent-publishing.ts, desktop-compatible wire format). Kind-5 address
 * deletions from the owner are applied live.
 *
 * Content JSON is parsed defensively (snake_case and camelCase) since the
 * wire shape is a backend snapshot rather than a documented NIP.
 */

import { useEffect, useState } from "react";
import { useRelay } from "@/shared/context/relay-context";
import type { NostrEvent } from "@/shared/lib/relay-connection";
import { DirectoryStore } from "./directory-store";

export const KIND_PERSONA = 30175;
export const KIND_TEAM = 30176;
export const KIND_MANAGED_AGENT = 30177;

export interface AgentPersona {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  systemPrompt: string;
  runtime: string | null;
  model: string | null;
  provider: string | null;
  isBuiltIn: boolean;
  /** owner-only | allowlist | anyone — used to prefill the edit dialog. */
  respondTo: string | null;
  /** True when the event carries ["shared","true"] (community catalog). */
  shared: boolean;
  /** Preserved verbatim through web edits (desktop contract fields). */
  namePool: string[];
  parallelism: number | null;
  respondToAllowlist: string[];
}

export interface AgentTeam {
  id: string;
  name: string;
  description: string | null;
  instructions: string | null;
  personaIds: string[];
  version: string | null;
}

export interface ManagedAgent {
  id: string;
  name: string | null;
  personaId: string | null;
  status: string | null;
  pubkey: string;
}

type Json = Record<string, unknown>;

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function parseContent(ev: NostrEvent): Json | null {
  try {
    const parsed: unknown = JSON.parse(ev.content);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Json)
      : null;
  } catch {
    return null;
  }
}

function parsePersona(ev: NostrEvent): AgentPersona | null {
  const c = parseContent(ev);
  const id = ev.tags.find((t) => t[0] === "d")?.[1] ?? str(c?.id);
  if (!id) return null;
  return {
    id,
    displayName: str(c?.display_name) ?? str(c?.displayName) ?? id,
    avatarUrl: str(c?.avatar_url) ?? str(c?.avatarUrl),
    systemPrompt: str(c?.system_prompt) ?? str(c?.systemPrompt) ?? "",
    runtime: str(c?.runtime),
    model: str(c?.model),
    provider: str(c?.provider),
    isBuiltIn: Boolean(c?.is_built_in ?? c?.isBuiltIn),
    respondTo: str(c?.respond_to) ?? str(c?.respondTo),
    shared: ev.tags.some((t) => t[0] === "shared" && t[1] === "true"),
    namePool: strList(c?.name_pool ?? c?.namePool),
    parallelism: typeof c?.parallelism === "number" ? c.parallelism : null,
    respondToAllowlist: strList(c?.respond_to_allowlist ?? c?.respondToAllowlist),
  };
}

function parseTeam(ev: NostrEvent): AgentTeam | null {
  const c = parseContent(ev);
  const id = ev.tags.find((t) => t[0] === "d")?.[1] ?? str(c?.id);
  if (!id) return null;
  return {
    id,
    name: str(c?.name) ?? id,
    description: str(c?.description),
    instructions: str(c?.instructions),
    personaIds: strList(c?.persona_ids ?? c?.personaIds),
    version: str(c?.version),
  };
}

function parseManagedAgent(ev: NostrEvent): ManagedAgent | null {
  const c = parseContent(ev);
  const id = ev.tags.find((t) => t[0] === "d")?.[1] ?? str(c?.id);
  if (!id) return null;
  return {
    id,
    name: str(c?.name) ?? str(c?.display_name) ?? str(c?.displayName),
    personaId: str(c?.persona_id) ?? str(c?.personaId),
    status: str(c?.status),
    pubkey: ev.pubkey,
  };
}

export function useAgentDirectory(): {
  personas: AgentPersona[];
  teams: AgentTeam[];
  agents: ManagedAgent[];
  isLoading: boolean;
} {
  const { connection, connectionState, identity } = useRelay();
  const owner = identity?.pubkey;
  const [personas, setPersonas] = useState<AgentPersona[]>([]);
  const [teams, setTeams] = useState<AgentTeam[]>([]);
  const [agents, setAgents] = useState<ManagedAgent[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!connection || connectionState !== "ready" || !owner) return;

    // Reconciliation lives in DirectoryStore: NIP-33 (created_at, event-id)
    // resolution plus tombstone suppression for replay-ordered deletes.
    const personaStore = new DirectoryStore<AgentPersona>();
    const teamStore = new DirectoryStore<AgentTeam>();
    const agentStore = new DirectoryStore<ManagedAgent>();

    // Kind-5 address deletions ("a": "<kind>:<owner>:<d-tag>") tombstone the
    // addressed record — mirrors desktop's subscription set.
    function applyDeletion(ev: NostrEvent): boolean {
      let changed = false;
      for (const tag of ev.tags) {
        if (tag[0] !== "a") continue;
        const [kindStr, , dTag] = (tag[1] ?? "").split(":");
        if (!dTag) continue;
        if (kindStr === String(KIND_PERSONA)) changed = personaStore.tombstone(dTag, ev.created_at) || changed;
        else if (kindStr === String(KIND_TEAM)) changed = teamStore.tombstone(dTag, ev.created_at) || changed;
        else if (kindStr === String(KIND_MANAGED_AGENT)) changed = agentStore.tombstone(dTag, ev.created_at) || changed;
      }
      return changed;
    }

    function syncAll(): void {
      setPersonas(personaStore.values());
      setTeams(teamStore.values());
      setAgents(agentStore.values());
    }

    const unsub = connection.subscribe(
      { kinds: [KIND_PERSONA, KIND_TEAM, KIND_MANAGED_AGENT, 5], authors: [owner], limit: 300 },
      (ev: NostrEvent) => {
        if (ev.kind === 5) {
          if (applyDeletion(ev)) syncAll();
          return;
        }
        if (ev.kind === KIND_PERSONA) {
          const p = parsePersona(ev);
          if (p && personaStore.put(p.id, ev.created_at, ev.id, p)) {
            setPersonas(personaStore.values());
          }
        } else if (ev.kind === KIND_TEAM) {
          const t = parseTeam(ev);
          if (t && teamStore.put(t.id, ev.created_at, ev.id, t)) {
            setTeams(teamStore.values());
          }
        } else if (ev.kind === KIND_MANAGED_AGENT) {
          const a = parseManagedAgent(ev);
          if (a && agentStore.put(a.id, ev.created_at, ev.id, a)) {
            setAgents(agentStore.values());
          }
        }
      },
      () => setIsLoading(false),
    );

    return () => unsub();
  }, [connection, connectionState, owner]);

  return { personas, teams, agents, isLoading };
}
