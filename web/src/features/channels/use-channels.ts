/**
 * Subscribe to NIP-29 group metadata (kind 39000) and return the channel list.
 * Re-runs whenever the relay connection becomes ready.
 */

import { useEffect, useState } from "react";
import { useRelay } from "@/shared/context/relay-context";
import { KIND_GROUP_METADATA, type Channel, type ChannelType } from "./types";
import type { NostrEvent } from "@/shared/lib/relay-connection";

function eventToChannel(ev: NostrEvent): Channel | null {
  const groupId = ev.tags.find((t) => t[0] === "d")?.[1];
  if (!groupId) return null;

  const name = ev.tags.find((t) => t[0] === "name")?.[1] ?? groupId;
  const about = ev.tags.find((t) => t[0] === "about")?.[1];
  const picture = ev.tags.find((t) => t[0] === "picture")?.[1];
  const isPrivate = ev.tags.some((t) => t[0] === "private");
  const channelType = (ev.tags.find((t) => t[0] === "t")?.[1] ?? "stream") as ChannelType;
  const model = ev.tags.find((t) => t[0] === "model")?.[1];

  return { groupId, name, about, picture, isPrivate, channelType, model };
}

export function useChannels(): {
  channels: Channel[];
  isLoading: boolean;
} {
  const { connection, connectionState } = useRelay();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [eoseReceived, setEoseReceived] = useState(false);

  useEffect(() => {
    if (!connection || connectionState !== "ready") return;

    // Reset on each reconnect so we don't accumulate stale data.
    setChannels([]);
    setEoseReceived(false);

    const seen = new Map<string, NostrEvent>();

    const unsub = connection.subscribe(
      { kinds: [KIND_GROUP_METADATA], limit: 200 },
      (ev) => {
        const groupId = ev.tags.find((t) => t[0] === "d")?.[1];
        if (!groupId) return;

        // Keep only the most recent event per group (replaceable event).
        const existing = seen.get(groupId);
        if (!existing || ev.created_at > existing.created_at) {
          seen.set(groupId, ev);
          setChannels(
            Array.from(seen.values())
              .map(eventToChannel)
              .filter((c): c is Channel => c !== null)
              .sort((a, b) => a.name.localeCompare(b.name)),
          );
        }
      },
      () => setEoseReceived(true),
    );

    return unsub;
  }, [connection, connectionState]);

  return { channels, isLoading: !eoseReceived };
}
