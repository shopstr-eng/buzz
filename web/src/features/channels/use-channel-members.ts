/**
 * Subscribe to NIP-29 group members (kind 39002) for a channel and identify
 * which members are AI agents (kind 10100 profile).
 *
 * Kind:39002 is stored channel-scoped by the relay, so its live fan-out only
 * reaches channel-scoped subscribers, not our global "#d" filter.  To handle
 * live membership changes we also subscribe to kind:44100/44101 (member-added /
 * member-removed notifications, which ARE fanned out globally).  Each notification
 * bumps a refetch key that tears down and rebuilds the 39002 subscription, pulling
 * the freshly-updated stored event.
 */

import { useEffect, useRef, useState } from "react";
import { useRelay } from "@/shared/context/relay-context";
import {
  KIND_GROUP_MEMBERS,
  KIND_AGENT_PROFILE,
  KIND_MEMBER_ADDED_NOTIFICATION,
  KIND_MEMBER_REMOVED_NOTIFICATION,
} from "./types";
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

  // Bumped each time a 44100/44101 notification arrives — forces the 39002
  // subscription to close and re-open so we pick up the updated stored event.
  const [refetchKey, setRefetchKey] = useState(0);

  // Stable refs to avoid stale closure captures in subscription callbacks.
  const membersRef = useRef<ChannelMember[]>([]);
  const agentPubkeysRef = useRef(new Set<string>());
  const agentUnsubRef = useRef<(() => void) | null>(null);

  // ── Live membership-notification watcher ──────────────────────────────────
  // Subscribes to kind:44100 (member added) and kind:44101 (member removed) for
  // this channel.  These are globally fanned out by the relay, so we receive them
  // even though the underlying 39002 update is channel-scoped.
  useEffect(() => {
    if (!connection || connectionState !== "ready" || !groupId) return;

    const unsub = connection.subscribe(
      {
        kinds: [KIND_MEMBER_ADDED_NOTIFICATION, KIND_MEMBER_REMOVED_NOTIFICATION],
        "#h": [groupId],
      },
      () => {
        // Each notification means the member list changed — bump the key so the
        // 39002 subscription below rebuilds and fetches the fresh stored event.
        setRefetchKey((k) => k + 1);
      },
    );

    return () => unsub();
  }, [connection, connectionState, groupId]);

  // ── Member-list subscription (re-runs when refetchKey changes) ────────────
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
  }, [connection, connectionState, groupId, refetchKey]);

  return { members, isLoading: !eoseReceived };
}
