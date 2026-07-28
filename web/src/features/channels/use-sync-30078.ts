/**
 * Cross-client read-state + pins sync over encrypted kind:30078 (NIP-78/NIP-RS,
 * desktop contract). ONE subscription (authors=me, kind 30078) routed by d/t
 * tag — the relay's parameterized-replaceable semantics keep the latest event
 * per d-tag, so every client owns one read-state slot plus the shared
 * "channel-stars" slot.
 *
 * Content is ALWAYS NIP-44-self-encrypted JSON — publishing plaintext 30078
 * would corrupt desktop's blobs. When NIP-44 is unavailable (NIP-07 without
 * nip44 support) the feature silently degrades to local-only.
 *
 * Read-state: d="read-state:<32hex slotId>", merged max-per-key across slots,
 * own slot republished on local marks (debounced). A foreign client_id on our
 * d-tag rotates our slotId (desktop collision rule). Desktop's msg:/thread:
 * markers are carried through merges but never pruned or interpreted.
 * Pins: d="channel-stars", LWW per channel by updatedAt.
 */

import { useEffect } from "react";
import { useRelay } from "@/shared/context/relay-context";
import { getSignFn } from "@/shared/lib/identity";
import { getNip44SelfAsync } from "@/shared/lib/nip44-self";
import {
  buildSlotPlaintext,
  channelMarkers,
  mergeContexts,
  parseSlotJson,
} from "./lib/read-state-sync";
import { parsePinsJson } from "./lib/pins-sync";
import { getReadStateSnapshot, markChannelRead, subscribeReadState } from "./use-read-state";
import { applyRemotePins, getPinsSnapshot, subscribePins } from "./use-pinned-channels";
import type { NostrEvent } from "@/shared/lib/relay-connection";

const KIND_APP_DATA = 30078;
const PUBLISH_DEBOUNCE_MS = 2000;

function loadOrCreate(key: string, gen: () => string): string {
  try {
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const value = gen();
    localStorage.setItem(key, value);
    return value;
  } catch {
    return gen();
  }
}

function randomHex(chars: number): string {
  const bytes = new Uint8Array(chars / 2);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Mount once (sidebar). Syncs read-state + pins with other clients. */
export function useSync30078(): void {
  const { connection, connectionState, identity } = useRelay();

  useEffect(() => {
    if (!connection || connectionState !== "ready" || !identity) return;
    const conn = connection;
    const me = identity.pubkey;
    const clientId = loadOrCreate(`buzz.nip-rs.client-id:${me}`, () => crypto.randomUUID());
    let slotId = loadOrCreate(`buzz.nip-rs.slot-id:${me}`, () => randomHex(32));
    let mergedContexts: Record<string, number> = {};
    let disposed = false;
    let readTimer: ReturnType<typeof setTimeout> | null = null;
    let pinsTimer: ReturnType<typeof setTimeout> | null = null;

    async function publish(dTag: string, tTag: string, plaintext: string): Promise<void> {
      const nip44 = await getNip44SelfAsync();
      const signFn = getSignFn();
      if (!nip44 || !signFn) return;
      const content = await nip44.encrypt(plaintext);
      const signed = await signFn({
        kind: KIND_APP_DATA,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ["d", dTag],
          ["t", tTag],
        ],
        content,
      });
      if (!disposed) conn.publish(signed);
    }

    function scheduleReadPublish(): void {
      if (readTimer) clearTimeout(readTimer);
      readTimer = setTimeout(() => {
        mergedContexts = mergeContexts(mergedContexts, getReadStateSnapshot());
        void publish(
          `read-state:${slotId}`,
          "read-state",
          buildSlotPlaintext(clientId, mergedContexts),
        );
      }, PUBLISH_DEBOUNCE_MS);
    }

    function schedulePinsPublish(): void {
      if (pinsTimer) clearTimeout(pinsTimer);
      pinsTimer = setTimeout(() => {
        void publish(
          "channel-stars",
          "channel-stars",
          JSON.stringify({ version: 1, channels: getPinsSnapshot() }),
        );
      }, PUBLISH_DEBOUNCE_MS);
    }

    const unsub = conn.subscribe(
      { kinds: [KIND_APP_DATA], authors: [me], limit: 50 },
      (ev: NostrEvent) => {
        const dTag = ev.tags.find((t) => t[0] === "d")?.[1];
        const tTag = ev.tags.find((t) => t[0] === "t")?.[1];
        void (async () => {
          if (disposed) return;
          const nip44 = await getNip44SelfAsync();
          if (!nip44) return;
          let plaintext: string;
          try {
            plaintext = await nip44.decrypt(ev.content);
          } catch {
            return; // undecryptable / foreign blob — ignore
          }
          if (disposed) return;

          if (dTag?.startsWith("read-state:") || tTag === "read-state") {
            const slot = parseSlotJson(plaintext);
            if (!slot) return;
            if (dTag === `read-state:${slotId}` && slot.client_id !== clientId) {
              // Foreign client on our d-tag: rotate to a fresh slot (desktop rule).
              slotId = randomHex(32);
              try {
                localStorage.setItem(`buzz.nip-rs.slot-id:${me}`, slotId);
              } catch {
                // storage unavailable — slot rotates in memory only
              }
            }
            mergedContexts = mergeContexts(mergedContexts, slot.contexts);
            for (const [channelId, ts] of channelMarkers(slot.contexts)) {
              markChannelRead(channelId, ts);
            }
          } else if (dTag === "channel-stars" || tTag === "channel-stars") {
            const pins = parsePinsJson(plaintext);
            if (pins) applyRemotePins(pins);
          }
        })();
      },
    );

    const offRead = subscribeReadState(scheduleReadPublish);
    const offPins = subscribePins(schedulePinsPublish);

    return () => {
      disposed = true;
      unsub();
      offRead();
      offPins();
      if (readTimer) clearTimeout(readTimer);
      if (pinsTimer) clearTimeout(pinsTimer);
    };
  }, [connection, connectionState, identity]);
}
