/**
 * Live view of the owner's OWN kind:30178 team-catalog heads, used to drive
 * the team share toggle. The relay always returns the author's own heads
 * (shared or not), so folding to the latest head per d-tag and checking the
 * exact ["shared","true"] tag tells us which teams are currently shared.
 */

import { useEffect, useState } from "react";
import { useRelay } from "@/shared/context/relay-context";
import type { NostrEvent } from "@/shared/lib/relay-connection";
import { personaEventIsShared } from "./lib/agent-catalog";
import { KIND_TEAM_CATALOG } from "./lib/team-catalog";

export function useOwnTeamShares(): {
  sharedTeamIds: Set<string>;
  /** Every team id with ANY kind:30178 head (shared or not) — a delete must also retract these. */
  catalogTeamIds: Set<string>;
  isLoading: boolean;
} {
  const { connection, connectionState, identity } = useRelay();
  const me = identity?.pubkey;
  const [sharedTeamIds, setSharedTeamIds] = useState<Set<string>>(new Set());
  const [catalogTeamIds, setCatalogTeamIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!connection || connectionState !== "ready" || !me) return;
    setIsLoading(true);
    // Latest head per team id — newest created_at wins, same-second ties go
    // to the larger event id (directory-store semantics).
    const heads = new Map<string, NostrEvent>();

    function recompute(): void {
      const next = new Set<string>();
      const all = new Set<string>();
      for (const [teamId, ev] of heads) {
        all.add(teamId);
        if (personaEventIsShared(ev)) next.add(teamId);
      }
      setSharedTeamIds(next);
      setCatalogTeamIds(all);
    }

    const unsub = connection.subscribe(
      { kinds: [KIND_TEAM_CATALOG], authors: [me], limit: 300 },
      (ev: NostrEvent) => {
        const d = ev.tags.find((t) => t[0] === "d")?.[1];
        if (!d) return;
        const existing = heads.get(d);
        if (
          !existing ||
          existing.created_at < ev.created_at ||
          (existing.created_at === ev.created_at && existing.id < ev.id)
        ) {
          heads.set(d, ev);
          recompute();
        }
      },
      () => {
        recompute();
        setIsLoading(false);
      },
    );
    return unsub;
  }, [connection, connectionState, me]);

  return { sharedTeamIds, catalogTeamIds, isLoading };
}
