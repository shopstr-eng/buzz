/**
 * Cross-client read-state + pins sync over encrypted kind:30078 (NIP-78/NIP-RS,
 * desktop contract). ONE live subscription (authors=me, kind 30078, no tag
 * filter, no since window) routed by d/t tag — the relay's
 * parameterized-replaceable semantics keep the latest event per d-tag, so
 * every client owns one read-state slot plus the shared "channel-stars" slot.
 *
 * Content is ALWAYS NIP-44-self-encrypted JSON — publishing plaintext 30078
 * would corrupt desktop's blobs. When NIP-44 is unavailable (NIP-07 without
 * nip44 support) the feature silently degrades to local-only.
 *
 * Read-state: d="read-state:<32hex slotId>", merged max-per-key across slots,
 * own slot republished on local marks (debounced). A foreign client_id on our
 * d-tag rotates our slotId (desktop collision rule); the next publish carries
 * all merged state — including every ov_* register — forward to the fresh
 * coordinate, which is the NIP-RS carry-forward requirement for abandoning a
 * coordinate.
 *
 * Manual-unread override layer (NIP-RS): web reads and writes ov_* override
 * groups, so the live subscription doubles as the full-state-load fence
 * (tag-free, no `since`), and a one-time enumeration establishes completeness
 * before mark-unread is permitted — a potentially incomplete load fails the
 * action visibly, never silently. Override entries live ONLY in the primary
 * coordinate (web is single-slot, so that is its only coordinate), are
 * validated as complete ov_s/ov_c/ov_b groups BEFORE merge (any other shape
 * rejects the whole group; the frontier entry is retained), canonicalized at
 * publication (live → 3 keys, dead → ov_c tombstone floor, virgin → omitted,
 * clear-wins on ties), and are exempt from budget eviction — when they alone
 * exceed the 32KB budget nothing is published and override actions fail.
 *
 * Pins: d="channel-stars", LWW per channel by updatedAt.
 */

import { useEffect } from "react";
import { useRelay } from "@/shared/context/relay-context";
import { getSignFn } from "@/shared/lib/identity";
import { getNip44SelfAsync } from "@/shared/lib/nip44-self";
import { buildSlot, mergeContexts, parseSlotJson } from "./lib/read-state-sync";
import {
  canonicalWireEntries,
  markReadRegister,
  planMarkUnread,
  splitContexts,
  type OverrideRegister,
} from "./lib/unread-override";
import { parsePinsJson } from "./lib/pins-sync";
import {
  clearChannelForcedUnread,
  getReadStateSnapshot,
  markChannelForcedUnread,
  markChannelRead,
  subscribeReadState,
  syncForcedFromOverrides,
} from "./use-read-state";
import { applyRemotePins, getPinsSnapshot, subscribePins } from "./use-pinned-channels";
import type { NostrEvent, RelayConnection } from "@/shared/lib/relay-connection";

const KIND_APP_DATA = 30078;
const PUBLISH_DEBOUNCE_MS = 2000;
const LOAD_QUERY_LIMIT = 50;
/** Continuations only advance on a non-empty page, so this cannot spin. */
const MAX_ENUMERATION_PAGES = 64;
const FLOOR_L = 2; // NIP-RS Full-State Load floor (fixed by the NIP)

export type MarkUnreadResult =
  | { ok: true }
  | { ok: false; reason: "not-ready" | "budget-exceeded" | "counter-exhausted" };

interface Session {
  markChannelUnread: (groupId: string, markerAtForce: number) => MarkUnreadResult;
  markChannelReadAction: (groupId: string, readTs: number) => MarkUnreadResult;
}

let currentSession: Session | null = null;

/**
 * Mark a channel unread (NIP-RS override layer). Requires a completed
 * full-state load; fails visibly otherwise. `markerAtForce` is the channel's
 * current local read marker — the override baseline and the local revert
 * point (desktop forced-unread semantics).
 */
export function markChannelUnread(groupId: string, markerAtForce: number): MarkUnreadResult {
  if (!currentSession) return { ok: false, reason: "not-ready" };
  return currentSession.markChannelUnread(groupId, markerAtForce);
}

/**
 * Explicit "Mark as read" (NIP-RS Actions): advance the frontier to `readTs`
 * AND increment ov_c (C = max(S, C) + 1) so the override deactivates even
 * when the frontier cannot advance past the baseline (e.g. a future-dated
 * message skewed it). Requires a completed full-state load; refuses visibly
 * at the uint32 counter ceiling or when the slot no longer fits the budget.
 */
export function markChannelReadAction(groupId: string, readTs: number): MarkUnreadResult {
  if (!currentSession) return { ok: false, reason: "not-ready" };
  return currentSession.markChannelReadAction(groupId, readTs);
}

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
    const conn: RelayConnection = connection;
    const me = identity.pubkey;
    const clientId = loadOrCreate(`buzz.nip-rs.client-id:${me}`, () => crypto.randomUUID());
    let slotId = loadOrCreate(`buzz.nip-rs.slot-id:${me}`, () => randomHex(32));
    let disposed = false;
    let readTimer: ReturnType<typeof setTimeout> | null = null;
    let pinsTimer: ReturnType<typeof setTimeout> | null = null;

    // Frontier entries keyed by RAW ctx id (unescaped); overrides by raw ctx.
    let frontier: Record<string, number> = {};
    let overrides: Record<string, OverrideRegister> = {};
    let lastPublishedJson: string | null = null;
    // null = full-state load in progress (override actions must fail visibly).
    let loadComplete: boolean | null = null;
    // Newest observed created_at per blob (keyed by client_id): the fence and
    // the enumeration overlap, and relay caps can withhold older coordinates
    // from one delivery — an older arrival must never clobber newer merges.
    const seenReadState = new Map<string, number>();

    function republishNow(): { fits: boolean } {
      const { json, fits } = buildSlot(
        clientId,
        frontier,
        canonicalWireEntries(overrides, frontier),
      );
      if (!fits) {
        console.warn("[sync-30078] primary slot over budget; not publishing");
        return { fits: false };
      }
      if (json !== lastPublishedJson) {
        lastPublishedJson = json;
        void publish(`read-state:${slotId}`, "read-state", json).catch((err) =>
          console.warn("[sync-30078] read-state publish failed:", err),
        );
      }
      return { fits: true };
    }

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
      if (loadComplete === null) return; // load in flight — its completion republishes
      if (readTimer) clearTimeout(readTimer);
      readTimer = setTimeout(() => {
        // Max-merge (never assign): a mark-unread revert lowers the LOCAL
        // marker, but the merged frontier is monotonic.
        frontier = mergeContexts(frontier, getReadStateSnapshot());
        if (!republishNow().fits && loadComplete !== null) loadComplete = false;
      }, PUBLISH_DEBOUNCE_MS);
    }

    function schedulePinsPublish(): void {
      if (pinsTimer) clearTimeout(pinsTimer);
      pinsTimer = setTimeout(() => {
        void publish(
          "channel-stars",
          "channel-stars",
          JSON.stringify({ version: 1, channels: getPinsSnapshot() }),
        ).catch((err) => console.warn("[sync-30078] pins publish failed:", err));
      }, PUBLISH_DEBOUNCE_MS);
    }

    function ingestReadStateEvent(ev: NostrEvent, plaintext: string): void {
      const slot = parseSlotJson(plaintext);
      if (!slot) return;
      const dTag = ev.tags.find((t) => t[0] === "d")?.[1];
      if (dTag === `read-state:${slotId}` && slot.client_id !== clientId) {
        // Foreign client on our d-tag: rotate to a fresh slot (desktop rule).
        // The next republishNow carries the full merged state — including all
        // ov_* registers — forward to the fresh coordinate before the old one
        // is abandoned (NIP-RS carry-forward).
        slotId = randomHex(32);
        try {
          localStorage.setItem(`buzz.nip-rs.slot-id:${me}`, slotId);
        } catch {
          // storage unavailable — slot rotates in memory only
        }
        lastPublishedJson = null;
        if (loadComplete !== null) republishNow();
      }
      const seenKey = slot.client_id === clientId ? "own" : `peer:${slot.client_id}`;
      if ((seenReadState.get(seenKey) ?? 0) > ev.created_at) return; // stale replay
      seenReadState.set(seenKey, ev.created_at);
      const { frontier: f, overrides: o } = splitContexts(slot.contexts);
      frontier = mergeContexts(frontier, f);
      for (const [ctx, reg] of Object.entries(o)) {
        const cur = overrides[ctx];
        overrides[ctx] = cur
          ? { s: Math.max(cur.s, reg.s), c: Math.max(cur.c, reg.c), b: Math.max(cur.b, reg.b) }
          : reg;
      }
      for (const [ctx, ts] of Object.entries(f)) {
        if (!ctx.startsWith("msg:") && !ctx.startsWith("thread:")) markChannelRead(ctx, ts);
      }
      // Apply the merged verdict to the badge store AFTER frontier marks: a
      // remote mark-unread lights the dot here, a remote clear (or a read
      // past the baseline anywhere) releases it.
      syncForcedFromOverrides(overrides, frontier);
    }

    async function runFullStateLoad(): Promise<void> {
      const nip44 = await getNip44SelfAsync();
      if (!nip44 || disposed) return;
      let cap = 0;
      let until: number | undefined;
      for (let page = 0; page < MAX_ENUMERATION_PAGES; page += 1) {
        const events: NostrEvent[] = [];
        const seen = new Set<string>();
        await new Promise<void>((resolve) => {
          const off = conn.subscribe(
            {
              kinds: [KIND_APP_DATA],
              authors: [me],
              limit: LOAD_QUERY_LIMIT,
              ...(until !== undefined ? { until } : {}),
            },
            (ev) => {
              if (!seen.has(ev.id)) {
                seen.add(ev.id);
                events.push(ev);
              }
            },
            () => {
              off();
              resolve();
            },
          );
        });
        if (disposed) return;
        const delivered = events.length;
        if (delivered > cap) cap = delivered;
        for (const ev of events) {
          let plaintext: string;
          try {
            plaintext = await nip44.decrypt(ev.content);
          } catch {
            continue; // foreign app data at this kind — not ours to read
          }
          if (disposed) return;
          ingestReadStateEvent(ev, plaintext);
        }
        // Discharge check: a page short of max(cap, L) proves its band
        // exhausted (read-state contributes one event per coordinate; the
        // fence collected any coordinate that moved above the cursor).
        if (delivered === 0 || delivered < Math.max(cap, FLOOR_L)) {
          loadComplete = true;
          // Pick up any local marks made while the load was in flight (their
          // debounced publishes were suppressed) before republishing.
          frontier = mergeContexts(frontier, getReadStateSnapshot());
          republishNow();
          return;
        }
        until = Math.min(...events.map((e) => e.created_at)) - 1;
        if (until < 0) break;
      }
      // Could not prove completeness — override actions fail visibly.
      loadComplete = false;
    }

    // Live fence subscription: tag-free, no `since`, established (EOSE)
    // BEFORE the first enumeration query and held for the session.
    const unsub = conn.subscribe(
      { kinds: [KIND_APP_DATA], authors: [me], limit: LOAD_QUERY_LIMIT },
      (ev) => {
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
            ingestReadStateEvent(ev, plaintext);
          } else if (dTag === "channel-stars" || tTag === "channel-stars") {
            const pins = parsePinsJson(plaintext);
            if (pins) applyRemotePins(pins);
          }
        })();
      },
      () => {
        // Fence established — run the enumeration exactly once.
        if (disposed || loadComplete !== null) return;
        void runFullStateLoad();
      },
    );

    currentSession = {
      markChannelUnread(groupId, markerAtForce) {
        if (loadComplete !== true) return { ok: false, reason: "not-ready" };
        // Baseline B must include local markers not yet merged into the wire
        // frontier (debounce window) — otherwise the register is dead on
        // arrival and canonicalization emits only a tombstone, so remote
        // devices would never see the force.
        const plan = planMarkUnread(overrides, frontier, getReadStateSnapshot(), groupId);
        if (!plan) return { ok: false, reason: "counter-exhausted" };
        const { fits } = buildSlot(
          clientId,
          plan.frontier,
          canonicalWireEntries(plan.overrides, plan.frontier),
        );
        if (!fits) return { ok: false, reason: "budget-exceeded" };
        overrides = plan.overrides;
        frontier = plan.frontier;
        markChannelForcedUnread(groupId, markerAtForce);
        scheduleReadPublish();
        return { ok: true };
      },
      markChannelReadAction(groupId, readTs) {
        if (loadComplete !== true) return { ok: false, reason: "not-ready" };
        // Effective frontier = merged wire frontier max-merged with local
        // markers still inside the debounce window, then advanced to readTs.
        const candidateFrontier = mergeContexts(frontier, getReadStateSnapshot());
        if ((candidateFrontier[groupId] ?? 0) < readTs) candidateFrontier[groupId] = readTs;
        let candidateOverrides = overrides;
        const reg = overrides[groupId];
        if (reg) {
          const next = markReadRegister(reg);
          if (!next) return { ok: false, reason: "counter-exhausted" };
          candidateOverrides = { ...overrides, [groupId]: next };
        }
        const { fits } = buildSlot(
          clientId,
          candidateFrontier,
          canonicalWireEntries(candidateOverrides, candidateFrontier),
        );
        if (!fits) return { ok: false, reason: "budget-exceeded" };
        overrides = candidateOverrides;
        frontier = candidateFrontier;
        // Local mirror: advance the marker and drop the forced pin outright —
        // the ov_c increment is the durable verdict, so the dot must clear
        // even when readTs cannot pass a future-skewed baseline.
        markChannelRead(groupId, readTs);
        clearChannelForcedUnread(groupId);
        scheduleReadPublish();
        return { ok: true };
      },
    };

    const offRead = subscribeReadState(scheduleReadPublish);
    const offPins = subscribePins(schedulePinsPublish);

    return () => {
      disposed = true;
      currentSession = null;
      unsub();
      offRead();
      offPins();
      if (readTimer) clearTimeout(readTimer);
      if (pinsTimer) clearTimeout(pinsTimer);
    };
  }, [connection, connectionState, identity]);
}
