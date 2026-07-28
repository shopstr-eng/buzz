/**
 * Community agent catalog: shared kind-30175 personas from ALL authors
 * (desktop personaCatalogRelay.ts contract). Pages every persona event with
 * an until-cursor past the relay's row clamp, folds to the latest head per
 * (author, d), keeps valid shared heads, and excludes the owner's own
 * personas (already shown in the Personas section). Provenance of copies is
 * localStorage-tracked so an already-added catalog agent shows as "Added".
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
import type { NostrEvent } from "@/shared/lib/relay-connection";

/** Mirrors desktop's CATALOG_PAGE_SIZE. */
const CATALOG_PAGE_SIZE = 500;
/** Safety cap: 3k personas is far past any real community catalog. */
const MAX_PAGES = 6;

export function useAgentCatalog(): {
  entries: CatalogPersona[];
  copied: Set<string>;
  markCopied: (coordinate: string) => void;
  isLoading: boolean;
} {
  const { connection, connectionState, identity } = useRelay();
  const me = identity?.pubkey;
  const [entries, setEntries] = useState<CatalogPersona[]>([]);
  const [copied, setCopied] = useState<Set<string>>(() => new Set(loadCatalogCopies()));
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!connection || connectionState !== "ready" || !me) return;
    const conn = connection;
    let disposed = false;
    setIsLoading(true);

    function fetchPage(until?: number): Promise<NostrEvent[]> {
      return new Promise((resolve) => {
        const events: NostrEvent[] = [];
        const unsub = conn.subscribe(
          {
            kinds: [KIND_PERSONA],
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

    void (async () => {
      const all: NostrEvent[] = [];
      let until: number | undefined;
      for (let page = 0; page < MAX_PAGES; page++) {
        const events = await fetchPage(until);
        if (disposed) return;
        if (events.length === 0) break;
        all.push(...events);
        if (events.length < CATALOG_PAGE_SIZE) break;
        const oldest = Math.min(...events.map((e) => e.created_at));
        if (until !== undefined && oldest >= until) break; // no-progress guard
        until = oldest;
      }
      const catalog = foldCatalogHeads(all).filter((e) => e.authorPubkey !== me);
      if (!disposed) {
        setEntries(catalog);
        setIsLoading(false);
      }
    })();

    return () => {
      disposed = true;
    };
  }, [connection, connectionState, me]);

  const markCopied = useCallback((coordinate: string) => {
    setCopied(new Set(recordCatalogCopy(coordinate)));
  }, []);

  return { entries, copied, markCopied, isLoading };
}
