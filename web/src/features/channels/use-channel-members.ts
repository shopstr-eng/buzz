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
 *
 * Mutation helpers kickMember / changeRole publish NIP-29 events (kind:9001 and
 * kind:9000).  The relay enforces role-based authorisation server-side; the hook
 * optimistically fires the event and lets the 44100/44101 notification path
 * reconcile the member list when the relay accepts the change.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRelay } from "@/shared/context/relay-context";
import {
  KIND_GROUP_MEMBERS,
  KIND_AGENT_PROFILE,
  KIND_MEMBER_ADDED_NOTIFICATION,
  KIND_MEMBER_REMOVED_NOTIFICATION,
  KIND_ADD_MEMBER,
  KIND_REMOVE_MEMBER,
} from "./types";
import type { NostrEvent } from "@/shared/lib/relay-connection";
import { getSignFn } from "@/shared/lib/identity";

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
  kickMember: (targetPubkey: string) => Promise<void>;
  changeRole: (targetPubkey: string, role: "admin" | "member") => Promise<void>;
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
          .map((t) => {
            // NIP-29 p-tag: ["p", pubkey, relay_hint?, role?]
            // relay_hint is optional — role may be at index 2 or 3.
            const ROLES = ["owner", "admin", "member"];
            const role = (
              ROLES.includes(t[3]) ? t[3] :
              ROLES.includes(t[2]) ? t[2] :
              "member"
            ) as ChannelMember["role"];
            return {
              pubkey: t[1],
              role,
              isAgent: agentPubkeysRef.current.has(t[1]),
            };
          })
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

  // ── Mutations ─────────────────────────────────────────────────────────────

  /** Remove a member from the channel by publishing kind:9001. Throws if relay rejects. */
  const kickMember = useCallback(
    async (targetPubkey: string) => {
      if (!connection) throw new Error("Not connected to relay.");
      if (!groupId) throw new Error("No channel selected.");
      const signFn = getSignFn();
      if (!signFn) throw new Error("No signing key available.");
      const signed = await signFn({
        kind: KIND_REMOVE_MEMBER,
        created_at: Math.floor(Date.now() / 1000),
        tags: [["h", groupId], ["p", targetPubkey]],
        content: "",
      });
      // publishAndWait surfaces relay OK false (permission error, etc.) as a thrown Error.
      await connection.publishAndWait(signed);
    },
    [connection, groupId],
  );

  /** Promote or demote a member by publishing kind:9000 with the new role. */
  const changeRole = useCallback(
    async (targetPubkey: string, role: "admin" | "member") => {
      if (!connection) throw new Error("Not connected to relay.");
      if (!groupId) throw new Error("No channel selected.");
      const signFn = getSignFn();
      if (!signFn) throw new Error("No signing key available.");
      const signed = await signFn({
        kind: KIND_ADD_MEMBER,
        created_at: Math.floor(Date.now() / 1000),
        tags: [["h", groupId], ["p", targetPubkey], ["role", role]],
        content: "",
      });
      connection.publish(signed);
    },
    [connection, groupId],
  );

  return { members, isLoading: !eoseReceived, kickMember, changeRole };
}
