import { useQuery } from "@tanstack/react-query";

import { relayClient } from "@/shared/api/relayClient";
import { useIdentityQuery } from "@/shared/api/hooks";
import type { RelayEvent } from "@/shared/api/types";
import { KIND_TEAM_CATALOG } from "@/shared/constants/kinds";

/**
 * Exact ["shared","true"] two-element shape — the same rule the relay
 * enforces at ingest, so this can never disagree with what foreign readers
 * actually see (mirrors `personaEventIsShared`).
 */
function catalogEventIsShared(event: RelayEvent): boolean {
  const sharedTags = event.tags.filter((tag) => tag[0] === "shared");
  return (
    sharedTags.length === 1 &&
    sharedTags[0]?.length === 2 &&
    sharedTags[0]?.[1] === "true"
  );
}

/** NIP-33 head: greatest created_at, ties broken by lowest event id. */
function selectHead(events: RelayEvent[]): RelayEvent | null {
  let head: RelayEvent | null = null;
  for (const event of events) {
    if (
      !head ||
      event.created_at > head.created_at ||
      (event.created_at === head.created_at && event.id < head.id)
    ) {
      head = event;
    }
  }
  return head;
}

/**
 * Whether the given team currently has a SHARED kind:30178 catalog head
 * published by this identity — i.e. deleting the team will also retract a
 * live community-catalog listing. `false` while loading or on relay errors:
 * the delete confirm copy only gains a sentence when sharing is confirmed,
 * so a failed lookup degrades to the ordinary copy rather than blocking.
 */
export function useTeamCatalogShared(teamId: string | null): boolean {
  const identityQuery = useIdentityQuery();
  const pubkey = identityQuery.data?.pubkey?.toLowerCase() ?? null;

  const query = useQuery({
    enabled: teamId !== null && pubkey !== null,
    queryKey: ["team-catalog-shared", pubkey, teamId],
    queryFn: async () => {
      const events = await relayClient.fetchEvents({
        kinds: [KIND_TEAM_CATALOG],
        authors: [pubkey as string],
        "#d": [teamId as string],
        limit: 10,
      });
      const head = selectHead(events);
      return head !== null && catalogEventIsShared(head);
    },
    staleTime: 30_000,
  });

  return query.data === true;
}
