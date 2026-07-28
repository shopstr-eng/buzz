/**
 * Owner-only agent memory viewer (kind 30174, NIP-AE). Engrams are
 * agent-authored, p-tagged to the owner, NIP-44-encrypted agent→owner, and
 * parameterized-replaceable per (agent, d-tag). Decrypted bodies fold into a
 * per-agent memory graph (core-rooted reachability — see lib/engrams.ts).
 * Degrades to an empty map when peer decryption is unavailable (NIP-07
 * without nip44).
 */

import { useEffect, useState } from "react";
import { useRelay } from "@/shared/context/relay-context";
import { getPeerDecryptor } from "@/shared/lib/nip44-peer";
import {
  EngramStore,
  buildMemoryGraph,
  parseEngramBody,
  type MemoryGraph,
} from "./lib/engrams";
import type { NostrEvent } from "@/shared/lib/relay-connection";

export const KIND_AGENT_ENGRAM = 30174;

export function useEngrams(): { byAgent: Map<string, MemoryGraph>; isLoading: boolean } {
  const { connection, connectionState, identity } = useRelay();
  const me = identity?.pubkey;
  const [byAgent, setByAgent] = useState<Map<string, MemoryGraph>>(new Map());
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!connection || connectionState !== "ready" || !me) return;
    const decryptor = getPeerDecryptor();
    if (!decryptor) {
      setByAgent(new Map());
      setIsLoading(false);
      return;
    }
    setByAgent(new Map());
    setIsLoading(true);
    const store = new EngramStore();

    function rebuild(): void {
      const entries = store.entries();
      const agents = [...new Set(entries.map((e) => e.agentPubkey))];
      const next = new Map<string, MemoryGraph>();
      for (const agent of agents) {
        next.set(agent, buildMemoryGraph(entries.filter((e) => e.agentPubkey === agent)));
      }
      setByAgent(next);
    }

    const unsub = connection.subscribe(
      { kinds: [KIND_AGENT_ENGRAM], "#p": [me], limit: 500 },
      (ev: NostrEvent) => {
        void (async () => {
          let plaintext: string;
          try {
            plaintext = await decryptor(ev.pubkey, ev.content);
          } catch {
            return; // undecryptable (not for us / wrong key) — ignore
          }
          const body = parseEngramBody(plaintext);
          if (!body) return;
          if (store.apply(ev, body)) rebuild();
        })();
      },
      () => setIsLoading(false),
    );

    return unsub;
  }, [connection, connectionState, me]);

  return { byAgent, isLoading };
}
