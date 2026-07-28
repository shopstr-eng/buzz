/**
 * Agent turn metrics (kind 44200, NIP-AM).
 *
 * buzz-acp publishes one event per completed agent turn: authored by the
 * agent, p-tagged to the owner, with an `agent` tag carrying the agent
 * pubkey. The content is NIP-44-encrypted to the owner; the plaintext is an
 * AgentTurnMetricPayload (`harness`, `model`, `session_id`, `turn_id`,
 * `turn_seq`, `timestamp`, and per-turn token counts incl. `cost_usd`).
 *
 * This hook decrypts with the owner's key and aggregates per (agent, model):
 * turns, input/output tokens, and total cost — the web equivalent of the
 * desktop's usage metrics surfaced from its local archive.
 */

import { useEffect, useRef, useState } from "react";
import { nip44 } from "nostr-tools";
import { useRelay } from "@/shared/context/relay-context";
import { getSecretKeyBytes } from "@/shared/lib/identity";
import type { NostrEvent } from "@/shared/lib/relay-connection";

export const KIND_AGENT_TURN_METRIC = 44200;

export interface AgentMetricAggregate {
  agentPubkey: string;
  model: string | null;
  harness: string | null;
  turns: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  lastTurnAt: number;
}

interface TurnMetricPayload {
  harness?: string;
  model?: string;
  timestamp?: string;
  // Per-turn counts — field name varies by publisher version.
  turn?: TokenCounts;
  usage?: TokenCounts;
  turn_counts?: TokenCounts;
}

interface TokenCounts {
  // Producer serializes camelCase; snake_case kept as a compatibility fallback.
  inputTokens?: number | null;
  outputTokens?: number | null;
  costUsd?: number | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  cost_usd?: number | null;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

export function useAgentMetrics(): {
  metrics: AgentMetricAggregate[];
  isLoading: boolean;
  /** True when metrics exist on the relay but no local key can decrypt them. */
  decryptUnavailable: boolean;
} {
  const { connection, connectionState, identity } = useRelay();
  const owner = identity?.pubkey;
  const [metrics, setMetrics] = useState<AgentMetricAggregate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [decryptUnavailable, setDecryptUnavailable] = useState(false);
  const secretKey = useRef<Uint8Array | null>(null);

  useEffect(() => {
    if (!connection || connectionState !== "ready" || !owner) return;

    secretKey.current = getSecretKeyBytes();
    const aggregates = new Map<string, AgentMetricAggregate>();
    const seen = new Set<string>();

    const unsub = connection.subscribe(
      { kinds: [KIND_AGENT_TURN_METRIC], "#p": [owner], limit: 1000 },
      (ev: NostrEvent) => {
        if (seen.has(ev.id)) return;
        seen.add(ev.id);

        const key = secretKey.current;
        if (!key) {
          setDecryptUnavailable(true);
          return;
        }
        const agentPubkey = ev.tags.find((t) => t[0] === "agent")?.[1] ?? ev.pubkey;

        let payload: TurnMetricPayload;
        try {
          const convKey = nip44.v2.utils.getConversationKey(key, agentPubkey);
          payload = JSON.parse(nip44.v2.decrypt(ev.content, convKey)) as TurnMetricPayload;
        } catch {
          // Not for us / undecryptable / malformed — skip.
          return;
        }

        const counts = payload.turn ?? payload.usage ?? payload.turn_counts ?? {};
        const mapKey = `${agentPubkey}:${payload.model ?? ""}`;
        const existing = aggregates.get(mapKey);
        aggregates.set(mapKey, {
          agentPubkey,
          model: payload.model ?? existing?.model ?? null,
          harness: payload.harness ?? existing?.harness ?? null,
          turns: (existing?.turns ?? 0) + 1,
          inputTokens: (existing?.inputTokens ?? 0) + num(counts.inputTokens ?? counts.input_tokens),
          outputTokens: (existing?.outputTokens ?? 0) + num(counts.outputTokens ?? counts.output_tokens),
          costUsd: (existing?.costUsd ?? 0) + num(counts.costUsd ?? counts.cost_usd),
          lastTurnAt: Math.max(existing?.lastTurnAt ?? 0, ev.created_at),
        });
        setMetrics(
          [...aggregates.values()].sort((a, b) => b.lastTurnAt - a.lastTurnAt),
        );
      },
      () => setIsLoading(false),
    );

    return () => unsub();
  }, [connection, connectionState, owner]);

  return { metrics, isLoading, decryptUnavailable };
}
