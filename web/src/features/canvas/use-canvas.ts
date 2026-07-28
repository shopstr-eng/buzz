/**
 * Channel canvas (kind 40100): one markdown document per channel, latest
 * event wins. h-scoped, MessagesWrite scope.
 */

import { useCallback, useEffect, useState } from "react";
import { useRelay } from "@/shared/context/relay-context";
import { getSignFn } from "@/shared/lib/identity";
import type { NostrEvent } from "@/shared/lib/relay-connection";

export const KIND_CANVAS = 40100;

export interface ChannelCanvas {
  content: string;
  authorPubkey: string;
  updatedAt: number;
}

export function useCanvas(groupId: string): {
  canvas: ChannelCanvas | null;
  isLoading: boolean;
  saveCanvas: (content: string) => Promise<void>;
} {
  const { connection, connectionState } = useRelay();
  const [canvas, setCanvas] = useState<ChannelCanvas | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!connection || connectionState !== "ready") return;
    setCanvas(null);
    setIsLoading(true);
    let latest: ChannelCanvas | null = null;

    const unsub = connection.subscribe(
      { kinds: [KIND_CANVAS], "#h": [groupId], limit: 20 },
      (ev: NostrEvent) => {
        if (latest && latest.updatedAt >= ev.created_at) return;
        latest = {
          content: ev.content,
          authorPubkey: ev.pubkey,
          updatedAt: ev.created_at,
        };
        setCanvas(latest);
      },
      () => setIsLoading(false),
    );

    return unsub;
  }, [connection, connectionState, groupId]);

  const saveCanvas = useCallback(
    async (content: string) => {
      if (!connection) return;
      const signFn = getSignFn();
      if (!signFn) throw new Error("No signing key available. Please log in again.");
      const signed = await signFn({
        kind: KIND_CANVAS,
        created_at: Math.floor(Date.now() / 1000),
        tags: [["h", groupId]],
        content,
      });
      connection.publish(signed);
    },
    [connection, groupId],
  );

  return { canvas, isLoading, saveCanvas };
}
