/**
 * Live agent activity via observer frames (kind 24200, NIP-AO-style).
 *
 * The buzz-acp harness publishes JSON observer envelopes p-tagged to the
 * owner: `{ seq, timestamp, kind, agent_index, channel_id, session_id,
 * turn_id, payload: { method, params } }` where `payload` is an ACP JSON-RPC
 * message. This hook folds them into a human-readable activity feed — the
 * web equivalent of the desktop's agentSessionTranscript parser (simplified:
 * prompts, agent text chunks, tool calls, turn lifecycle).
 *
 * Subscription mirrors the desktop's observerRelay.ts: `#p` = owner with a
 * 5-minute lookback so prompts that started just before subscribe aren't
 * missed.
 */

import { useEffect, useState } from "react";
import { useRelay } from "@/shared/context/relay-context";
import type { NostrEvent } from "@/shared/lib/relay-connection";

export const KIND_AGENT_OBSERVER_FRAME = 24200;

export type AgentActivityKind =
  | "prompt"
  | "message"
  | "tool_call"
  | "turn_started"
  | "turn_ended"
  | "status";

export interface AgentActivityItem {
  /** event id — stable key, dedupe on replay. */
  id: string;
  kind: AgentActivityKind;
  agentPubkey: string;
  sessionId: string | null;
  turnId: string | null;
  channelId: string | null;
  text: string;
  at: number;
}

interface ObserverEnvelope {
  seq?: number;
  timestamp?: string;
  kind?: string;
  channel_id?: string | null;
  session_id?: string | null;
  turn_id?: string | null;
  payload?: { method?: string; params?: Record<string, unknown> };
}

const LOOKBACK_SECS = 300;
const MAX_ITEMS = 200;

/** Extract human-readable text from a session/prompt params object. */
function promptText(params: Record<string, unknown> | undefined): string {
  const blocks = params?.prompt;
  if (!Array.isArray(blocks)) return "";
  return blocks
    .map((b) =>
      b && typeof b === "object" && (b as { type?: string }).type === "text"
        ? ((b as { text?: string }).text ?? "")
        : "",
    )
    .filter(Boolean)
    .join("\n");
}

/** Extract text/tool info from a session/update params object. */
function updateText(params: Record<string, unknown> | undefined): {
  kind: AgentActivityKind;
  text: string;
} | null {
  const update = params?.update as Record<string, unknown> | undefined;
  if (!update) return null;
  const updateKind = typeof update.sessionUpdate === "string" ? update.sessionUpdate : "";
  if (updateKind === "agent_message_chunk") {
    const content = update.content as { type?: string; text?: string } | undefined;
    return content?.type === "text" && content.text
      ? { kind: "message", text: content.text }
      : null;
  }
  if (updateKind === "tool_call" || updateKind === "tool_call_update") {
    const title =
      (typeof update.title === "string" && update.title) ||
      (typeof update.name === "string" && update.name) ||
      "tool call";
    return { kind: "tool_call", text: title };
  }
  return null;
}

function parseFrame(ev: NostrEvent): AgentActivityItem | null {
  let env: ObserverEnvelope;
  try {
    env = JSON.parse(ev.content) as ObserverEnvelope;
  } catch {
    return null;
  }
  const method = env.payload?.method ?? "";
  const base = {
    id: ev.id,
    agentPubkey: ev.pubkey,
    sessionId: env.session_id ?? null,
    turnId: env.turn_id ?? null,
    channelId: env.channel_id ?? null,
    at: ev.created_at,
  };

  if (env.kind === "acp_write" && method === "session/prompt") {
    const text = promptText(env.payload?.params);
    return text ? { ...base, kind: "prompt", text } : null;
  }
  if (env.kind === "acp_read" && method === "session/update") {
    const parsed = updateText(env.payload?.params);
    return parsed ? { ...base, ...parsed } : null;
  }
  if (method === "turn_started" || env.kind === "turn_started") {
    return { ...base, kind: "turn_started", text: "Turn started" };
  }
  if (method === "turn_ended" || env.kind === "turn_ended") {
    return { ...base, kind: "turn_ended", text: "Turn ended" };
  }
  return null;
}

export function useAgentActivity(): {
  items: AgentActivityItem[];
  isLoading: boolean;
} {
  const { connection, connectionState, identity } = useRelay();
  const owner = identity?.pubkey;
  const [items, setItems] = useState<AgentActivityItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!connection || connectionState !== "ready" || !owner) return;

    const seen = new Set<string>();
    const list: AgentActivityItem[] = [];
    const now = Math.floor(Date.now() / 1000);

    const unsub = connection.subscribe(
      {
        kinds: [KIND_AGENT_OBSERVER_FRAME],
        "#p": [owner],
        limit: 1000,
        since: now - LOOKBACK_SECS,
      },
      (ev: NostrEvent) => {
        if (seen.has(ev.id)) return;
        seen.add(ev.id);
        const item = parseFrame(ev);
        if (!item) return;
        list.push(item);
        list.sort((a, b) => b.at - a.at);
        if (list.length > MAX_ITEMS) list.length = MAX_ITEMS;
        setItems([...list]);
      },
      () => setIsLoading(false),
    );

    return () => unsub();
  }, [connection, connectionState, owner]);

  return { items, isLoading };
}
