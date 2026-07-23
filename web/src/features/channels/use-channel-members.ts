/**
 * Subscribe to NIP-29 group members (kind 39002) for a channel and identify
 * which members are AI agents (kind 10100 profile).
 */

import { useEffect, useRef, useState } from "react";
import { useRelay } from "@/shared/context/relay-context";
import { KIND_GROUP_MEMBERS, KIND_AGENT_PROFILE } from "./types";
import type { NostrEvent } from "@/shared/lib/relay-connection";

export interface ChannelMember {
  pubkey: string;
  role: "owner" | "admin" | "member";
  isAgent: boolean;
}

function roleSortOrder(role: ChannelMember["role"]): number {
  return role === "owner" ? 0 : role === "admin" ? 1 : 2;
}

export function useChannelMembers(groupId: string | null): {
  members: ChannelMember[];
  isLoading: boolean;
} {
  const { connection, connectionState } = useRelay();
  const [members, setMembers] = useState<ChannelMember[]>([]);
  const [eoseReceived, setEoseReceived] = useState(false);

  // Stable refs to avoid stale closure captures in subscription callbacks.
  const membersRef = useRef<ChannelMember[]>([]);
  const agentPubkeysRef = useRef(new Set<string>());
  const agentUnsubRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!connection || connectionState !== "ready" || !groupId) return;

    membersRef.current = [];
    agentPubkeysRef.current = new Set();
    setMembers([]);
    setEoseReceived(false);

    // Subscribe to kind:39002 for this channel's member list.
    const membersUnsub = connection.subscribe(
      { kinds: [KIND_GROUP_MEMBERS], "#d": [groupId], limit: 1 },
      (ev: NostrEvent) => {
        // kind:39002 p-tags: ["p", pubkey, relay_url, role]
        const parsed: ChannelMember[] = ev.tags
          .filter((t) => t[0] === "p" && t[1])
          .map((t) => ({
            pubkey: t[1],
            role: (["owner", "admin", "member"].includes(t[3])
              ? t[3]
              : "member") as ChannelMember["role"],
            isAgent: agentPubkeysRef.current.has(t[1]),
          }))
          .sort((a, b) => roleSortOrder(a.role) - roleSortOrder(b.role));

        membersRef.current = parsed;
        setMembers([...parsed]);

        // Subscribe to kind:10100 for these pubkeys to detect agents.
        agentUnsubRef.current?.();
        if (parsed.length > 0) {
          const authors = parsed.map((m) => m.pubkey);
          agentUnsubRef.current = connection.subscribe(
            { kinds: [KIND_AGENT_PROFILE], authors, limit: 200 },
            (agentEv: NostrEvent) => {
              agentPubkeysRef.current.add(agentEv.pubkey);
              setMembers(
                membersRef.current.map((m) => ({
                  ...m,
                  isAgent: agentPubkeysRef.current.has(m.pubkey),
                })),
              );
            },
          );
        }
      },
      () => setEoseReceived(true),
    );

    return () => {
      membersUnsub();
      agentUnsubRef.current?.();
      agentUnsubRef.current = null;
    };
  }, [connection, connectionState, groupId]);

  return { members, isLoading: !eoseReceived };
}
