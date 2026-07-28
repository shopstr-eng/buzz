/**
 * Community people directory for pickers (e.g. New DM): every kind:0 profile
 * published in this community, latest-wins per pubkey, sorted by name.
 */

import { useEffect, useState } from "react";
import { useRelay } from "@/shared/context/relay-context";

export interface CommunityPerson {
  pubkey: string;
  name: string;
}

/** display_name wins over name (NIP-01 convention); null when unusable. */
export function parseProfileName(content: string): string | null {
  try {
    const parsed: unknown = JSON.parse(content);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const c = parsed as Record<string, unknown>;
    const candidate = c.display_name ?? c.name;
    return typeof candidate === "string" && candidate.trim() ? candidate.trim() : null;
  } catch {
    return null;
  }
}

export function useCommunityPeople(): CommunityPerson[] {
  const { connection, connectionState } = useRelay();
  const [people, setPeople] = useState<CommunityPerson[]>([]);

  useEffect(() => {
    if (!connection || connectionState !== "ready") return;
    const byPubkey = new Map<string, { at: number; name: string }>();

    const unsub = connection.subscribe({ kinds: [0], limit: 500 }, (ev) => {
      const name = parseProfileName(ev.content);
      if (!name) return;
      const existing = byPubkey.get(ev.pubkey);
      if (existing && existing.at >= ev.created_at) return;
      byPubkey.set(ev.pubkey, { at: ev.created_at, name });
      setPeople(
        [...byPubkey.entries()]
          .map(([pubkey, v]) => ({ pubkey, name: v.name }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
    });

    return unsub;
  }, [connection, connectionState]);

  return people;
}
