/**
 * Agent directory (read-only): personas (kind 30175), teams (30176) and
 * managed agent instances (30177). These are owner-authored, addressable
 * (`d` tag) snapshots published by the backend — secrets-stripped mirrors of
 * the desktop's Tauri records. The web displays them; creation/editing stays
 * in the desktop app and admin console.
 *
 * Content JSON is parsed defensively (snake_case and camelCase) since the
 * wire shape is a backend snapshot rather than a documented NIP.
 */

import { useEffect, useState } from "react";
import { useRelay } from "@/shared/context/relay-context";
import type { NostrEvent } from "@/shared/lib/relay-connection";

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

    // Addressable events: latest per (kind, d-tag) wins — compare created_at,
    // not arrival order, so replayed older snapshots can't replace newer ones.
    const personaMap = new Map<string, { at: number; value: AgentPersona }>();
    const teamMap = new Map<string, { at: number; value: AgentTeam }>();
    const agentMap = new Map<string, { at: number; value: ManagedAgent }>();

    function put<T>(map: Map<string, { at: number; value: T }>, id: string, at: number, value: T): boolean {
      const existing = map.get(id);
      if (existing && existing.at > at) return false;
      map.set(id, { at, value });
      return true;
    }

    const unsub = connection.subscribe(
      { kinds: [KIND_PERSONA, KIND_TEAM, KIND_MANAGED_AGENT], authors: [owner], limit: 300 },
      (ev: NostrEvent) => {
        if (ev.kind === KIND_PERSONA) {
          const p = parsePersona(ev);
          if (p && put(personaMap, p.id, ev.created_at, p)) {
            setPersonas([...personaMap.values()].map((e) => e.value));
          }
        } else if (ev.kind === KIND_TEAM) {
          const t = parseTeam(ev);
          if (t && put(teamMap, t.id, ev.created_at, t)) {
            setTeams([...teamMap.values()].map((e) => e.value));
          }
        } else if (ev.kind === KIND_MANAGED_AGENT) {
          const a = parseManagedAgent(ev);
          if (a && put(agentMap, a.id, ev.created_at, a)) {
            setAgents([...agentMap.values()].map((e) => e.value));
          }
        }
      },
      () => setIsLoading(false),
    );

    return () => unsub();
  }, [connection, connectionState, owner]);

  return { personas, teams, agents, isLoading };
}
