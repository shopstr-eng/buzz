/**
 * Subscribe to kind:0 (user metadata) and kind:10100 (AI agent profile) for
 * a given list of pubkeys. Returns a stable Map that updates as events arrive.
 *
 * Both kinds share the same JSON content schema:
 *   { name?, display_name?, about?, picture? }
 * display_name takes priority over name for the resolved `name` field.
 */

import { useEffect, useMemo, useState } from "react";
import { useRelay } from "@/shared/context/relay-context";
import type { NostrEvent } from "@/shared/lib/relay-connection";

export interface Profile {
  /** Resolved display name: display_name || name from event content. */
  name: string | null;
  about: string | null;
  picture: string | null;
}

export function useProfiles(pubkeys: readonly string[]): Map<string, Profile> {
  const { connection, connectionState } = useRelay();
  const [profiles, setProfiles] = useState<Map<string, Profile>>(new Map());

  // Stable stringified key so the effect only re-runs when the *contents*
  // of the pubkey list change, not the array reference.
  const pubkeyKey = useMemo(
    () => [...pubkeys].sort().join(","),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pubkeys],
  );

  useEffect(() => {
    if (!connection || connectionState !== "ready" || pubkeys.length === 0)
      return;

    const authors = [...pubkeys];

    // kind:0 = NIP-01 user metadata; kind:10100 = Buzz AI agent profile.
    const unsub = connection.subscribe(
      { kinds: [0, 10100], authors },
      (ev: NostrEvent) => {
        try {
          const c = JSON.parse(ev.content) as Record<string, unknown>;
          const raw =
            (typeof c.display_name === "string" && c.display_name.trim()) ||
            (typeof c.name === "string" && c.name.trim()) ||
            null;
          const about =
            typeof c.about === "string" ? c.about.trim() || null : null;
          const picture =
            typeof c.picture === "string" ? c.picture.trim() || null : null;

          setProfiles((prev) => {
            // Only update if something actually changed.
            const existing = prev.get(ev.pubkey);
            if (
              existing?.name === raw &&
              existing?.about === about &&
              existing?.picture === picture
            )
              return prev;
            const next = new Map(prev);
            next.set(ev.pubkey, { name: raw, about, picture });
            return next;
          });
        } catch {
          // Malformed JSON content — skip silently.
        }
      },
    );

    return () => unsub();
    // pubkeys itself changes reference on every render; use pubkeyKey instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection, connectionState, pubkeyKey]);

  return profiles;
}
