/**
 * Community agent catalog: shared kind-30175 personas AND kind-30178 team
 * projections from ALL authors (desktop personaCatalogRelay.ts contract).
 * Pages every event of each kind with an until-cursor past the relay's row
 * clamp, folds to the latest head per (author, d), keeps valid shared heads,
 * and excludes the owner's own entries (already shown in their own
 * sections). Provenance of copies is localStorage-tracked so an
 * already-added catalog agent/team shows as "Added".
 */

import { useCallback, useEffect, useState } from "react";
import { useRelay } from "@/shared/context/relay-context";
import {
  foldCatalogHeads,
  loadCatalogCopies,
  recordCatalogCopy,
  KIND_PERSONA,
  type CatalogPersona,
} from "./lib/agent-catalog";
import {
  foldTeamCatalogHeads,
  KIND_TEAM_CATALOG,
  type CatalogTeam,
} from "./lib/team-catalog";
import type { NostrEvent } from "@/shared/lib/relay-connection";

/** Mirrors desktop's CATALOG_PAGE_SIZE. */
const CATALOG_PAGE_SIZE = 500;
/** Safety cap: 3k personas is far past any real community catalog. */
const MAX_PAGES = 6;

export function useAgentCatalog(): {
  entries: CatalogPersona[];
  teams: CatalogTeam[];
  copied: Set<string>;
  markCopied: (coordinate: string) => void;
  isLoading: boolean;
} {
  const { connection, connectionState, identity } = useRelay();
  const me = identity?.pubkey;
  const [entries, setEntries] = useState<CatalogPersona[]>([]);
  const [teams, setTeams] = useState<CatalogTeam[]>([]);
  const [copied, setCopied] = useState<Set<string>>(() => new Set(loadCatalogCopies()));
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!connection || connectionState !== "ready" || !me) return;
    const conn = connection;
    let disposed = false;
    setIsLoading(true);

    function fetchPage(kind: number, until?: number): Promise<NostrEvent[]> {
      return new Promise((resolve) => {
        const events: NostrEvent[] = [];
        const unsub = conn.subscribe(
          {
            kinds: [kind],
            limit: CATALOG_PAGE_SIZE,
            ...(until === undefined ? {} : { until }),
          },
          (ev: NostrEvent) => events.push(ev),
          () => {
            unsub();
            resolve(events);
          },
        );
      });
    }

    // Page every event of one kind past the relay's row clamp. The relay's
    // shared-gate already hides foreign unshared heads server-side; the
    // client still re-checks the shared tag on the latest head per (author,d)
    // because our OWN unshared events do come back (author-visible).
    async function fetchAll(kind: number): Promise<NostrEvent[]> {
      const all: NostrEvent[] = [];
      let until: number | undefined;
      for (let page = 0; page < MAX_PAGES; page++) {
        const events = await fetchPage(kind, until);
        if (disposed) return all;
        if (events.length === 0) break;
        all.push(...events);
        if (events.length < CATALOG_PAGE_SIZE) break;
        const oldest = Math.min(...events.map((e) => e.created_at));
        if (until !== undefined && oldest >= until) break; // no-progress guard
        until = oldest;
      }
      return all;
    }

    void (async () => {
      const [personaEvents, teamEvents] = await Promise.all([
        fetchAll(KIND_PERSONA),
        fetchAll(KIND_TEAM_CATALOG),
      ]);
      if (disposed) return;
      const catalog = foldCatalogHeads(personaEvents).filter((e) => e.authorPubkey !== me);
      const teamCatalog = foldTeamCatalogHeads(teamEvents).filter((t) => t.authorPubkey !== me);
      setEntries(catalog);
      setTeams(teamCatalog);
      setIsLoading(false);
    })();

    return () => {
      disposed = true;
    };
  }, [connection, connectionState, me]);

  const markCopied = useCallback((coordinate: string) => {
    setCopied(new Set(recordCatalogCopy(coordinate)));
  }, []);

  return { entries, teams, copied, markCopied, isLoading };
}
