/**
 * Open (or find) a DM channel: kind 41010 with a p tag per other participant.
 * The relay resolves the participant set idempotently — same set, same channel —
 * and emits kind:39000 discovery with t=dm + p tags.
 */

import { useCallback, useState } from "react";
import { nip19 } from "nostr-tools";
import { useRelay } from "@/shared/context/relay-context";
import { getSignFn } from "@/shared/lib/identity";
import { KIND_DM_OPEN, type Channel } from "../channels/types";

const HEX64_RE = /^[0-9a-f]{64}$/i;

/** Parse an npub or hex pubkey input; returns hex or null. */
export function parsePubkeyInput(input: string): string | null {
  const trimmed = input.trim();
  if (HEX64_RE.test(trimmed)) return trimmed.toLowerCase();
  if (trimmed.startsWith("npub1")) {
    try {
      const decoded = nip19.decode(trimmed);
      if (decoded.type === "npub") return decoded.data as string;
    } catch {
      return null;
    }
  }
  return null;
}

/** Find the DM channel matching exactly this participant set (includes self). */
export function findDmChannel(
  channels: Channel[],
  participants: Set<string>,
): Channel | undefined {
  return channels.find((c) => {
    if (c.channelType !== "dm" || !c.participantPubkeys) return false;
    if (c.participantPubkeys.length !== participants.size) return false;
    return c.participantPubkeys.every((pk) => participants.has(pk));
  });
}

export function useOpenDm(): {
  openDm: (otherPubkeys: string[]) => Promise<boolean>;
  error: string | null;
} {
  const { connection, identity } = useRelay();
  const [error, setError] = useState<string | null>(null);

  const openDm = useCallback(
    async (otherPubkeys: string[]): Promise<boolean> => {
      if (!connection || !identity) {
        setError("Not connected to the relay.");
        return false;
      }
      const others = [...new Set(otherPubkeys.filter((pk) => pk !== identity.pubkey))];
      if (others.length === 0) {
        setError("Add at least one other participant.");
        return false;
      }
      if (others.length > 8) {
        setError("A DM can have at most 8 participants.");
        return false;
      }

      const signFn = getSignFn();
      if (!signFn) {
        setError("No signing key available. Please log in again.");
        return false;
      }

      setError(null);
      try {
        const signed = await signFn({
          kind: KIND_DM_OPEN,
          created_at: Math.floor(Date.now() / 1000),
          tags: others.map((pk) => ["p", pk]),
          content: "",
        });
        connection.publish(signed);
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to open conversation.");
        return false;
      }
    },
    [connection, identity],
  );

  return { openDm, error };
}
