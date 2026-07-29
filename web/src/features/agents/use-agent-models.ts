/**
 * Fetch the OpenRouter model catalog via the owner-only admin endpoint
 * (GET /api/admin/v1/settings/agent-models). The relay proxies the configured
 * OpenAI-compatible provider (keyless OpenRouter) and normalizes pricing to
 * USD per million tokens.
 *
 * The endpoint is owner-only (NIP-98); on any failure (non-owner, relay
 * without the keyless key, network) we fall back to a small static shortlist
 * so the picker still renders — free text is always accepted.
 */

import { useEffect, useState } from "react";
import { makeNip98AuthHeader } from "@/shared/lib/nip98";
import { relayHttpBaseUrl } from "@/shared/lib/relay-url";

export type AgentModel = {
  id: string;
  name: string;
  context_length: number | null;
  prompt_per_million: number | null;
  completion_per_million: number | null;
};

const FALLBACK_MODELS: AgentModel[] = [
  {
    id: "anthropic/claude-opus-4.5",
    name: "Anthropic: Claude Opus 4.5",
    context_length: 200_000,
    prompt_per_million: null,
    completion_per_million: null,
  },
  {
    id: "anthropic/claude-sonnet-4.5",
    name: "Anthropic: Claude Sonnet 4.5",
    context_length: 200_000,
    prompt_per_million: null,
    completion_per_million: null,
  },
  {
    id: "anthropic/claude-haiku-4.5",
    name: "Anthropic: Claude Haiku 4.5",
    context_length: 200_000,
    prompt_per_million: null,
    completion_per_million: null,
  },
  {
    id: "openai/gpt-5.2",
    name: "OpenAI: GPT-5.2",
    context_length: 400_000,
    prompt_per_million: null,
    completion_per_million: null,
  },
  {
    id: "google/gemini-3-pro",
    name: "Google: Gemini 3 Pro",
    context_length: 1_000_000,
    prompt_per_million: null,
    completion_per_million: null,
  },
  {
    id: "moonshotai/kimi-k3",
    name: "Moonshot: Kimi K3",
    context_length: 262_144,
    prompt_per_million: null,
    completion_per_million: null,
  },
];

async function fetchAgentModels(): Promise<AgentModel[]> {
  const url = `${relayHttpBaseUrl().replace(/\/+$/, "")}/api/admin/v1/settings/agent-models`;
  const authorization = await makeNip98AuthHeader(url, "GET");
  const response = await fetch(url, {
    headers: { Authorization: authorization },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const models = (await response.json()) as unknown;
  if (!Array.isArray(models) || models.length === 0) {
    throw new Error("empty model catalog");
  }
  return models as AgentModel[];
}

/** Shared across mounts so opening several dialogs triggers one fetch. */
let cache: Promise<AgentModel[]> | null = null;

export function useAgentModels(): {
  models: AgentModel[];
  isLoading: boolean;
  /** True when the live catalog was unreachable and the static shortlist is shown. */
  isFallback: boolean;
} {
  const [state, setState] = useState<{
    models: AgentModel[];
    isLoading: boolean;
    isFallback: boolean;
  }>({ models: [], isLoading: true, isFallback: false });

  useEffect(() => {
    cache ??= fetchAgentModels().catch(() => {
      // Reset so the next mount retries; serve the shortlist for now.
      cache = null;
      return FALLBACK_MODELS;
    });
    let cancelled = false;
    void cache.then((models) => {
      if (!cancelled) {
        setState({ models, isLoading: false, isFallback: models === FALLBACK_MODELS });
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
