import type { ForcedUnreadMap } from "@/features/channels/forcedUnreadStore";

/**
 * Pure reconcile step for the forced-unread overlay, extracted from
 * useUnreadChannels so it can be unit-tested without a React harness.
 *
 * Runs on every read-state change:
 * 1. Drain synced advances — a cross-device read clears LEGACY local-only
 *    forces (entries without an ov_* register).
 * 2. Mirror the merged NIP-RS override verdict (like web's
 *    syncForcedFromOverrides): an active ov_* group — set on ANY device —
 *    lights the dot here; a register that went inactive (remote ov_c clear
 *    or a frontier advance past its baseline) releases it.
 * 3. Replay legacy local-only forces (made while the override layer was
 *    unavailable, e.g. offline) through markContextUnread once the
 *    full-state load has proven complete, so the force syncs to other
 *    devices. Forces the frontier has since covered (a later read advanced
 *    the marker past the force-time baseline) are dropped, not resurrected.
 *    Failed replays are kept in the map so the next read-state change
 *    retries them.
 *
 * Mutates `forced` in place and returns true when anything changed (caller
 * persists + re-renders).
 */

export type OverrideStatus = "none" | "active" | "inactive";

export type MarkContextUnreadResult =
  | { ok: true; baseline: number | null }
  | { ok: false; reason: string };

export type ReconcileReadState = {
  drainSyncedAdvances: () => ReadonlySet<string>;
  getOverrideStatus: (contextId: string) => OverrideStatus;
  getActiveOverrides: () => Record<string, number>;
  isLoadComplete: () => boolean;
  getOwnTimestamp: (contextId: string) => number | null;
  markContextUnread: (contextId: string) => MarkContextUnreadResult;
};

export function isNonChannelContext(ctx: string): boolean {
  return ctx.startsWith("msg:") || ctx.startsWith("thread:");
}

export function reconcileForcedUnread(
  forced: ForcedUnreadMap,
  readState: ReconcileReadState,
  warn: (message: string) => void = (message) => console.warn(message),
): boolean {
  const {
    drainSyncedAdvances,
    getOverrideStatus,
    getActiveOverrides,
    isLoadComplete,
    getOwnTimestamp,
    markContextUnread,
  } = readState;

  const advanced = drainSyncedAdvances();
  let anyNew = false;
  for (const channelId of advanced) {
    if (
      Object.hasOwn(forced, channelId) &&
      getOverrideStatus(channelId) === "none"
    ) {
      delete forced[channelId];
      anyNew = true;
    }
  }
  const activeOverrides = getActiveOverrides();
  for (const [ctx, baseline] of Object.entries(activeOverrides)) {
    if (isNonChannelContext(ctx)) continue;
    if (forced[ctx] !== baseline) {
      forced[ctx] = baseline;
      anyNew = true;
    }
  }
  for (const ctx of Object.keys(forced)) {
    if (
      !Object.hasOwn(activeOverrides, ctx) &&
      getOverrideStatus(ctx) === "inactive"
    ) {
      delete forced[ctx];
      anyNew = true;
    }
  }
  if (isLoadComplete()) {
    for (const [ctx, baseline] of Object.entries(forced)) {
      if (isNonChannelContext(ctx)) continue;
      // Entries with a register (any status) already went through the
      // override layer — only legacy local-only forces need replay.
      if (getOverrideStatus(ctx) !== "none") continue;
      const own = getOwnTimestamp(ctx);
      if (own !== null && own > (baseline ?? 0)) {
        // A later read advanced the marker past the force-time baseline —
        // the cross-device read wins; don't resurrect the force.
        delete forced[ctx];
        anyNew = true;
        continue;
      }
      const result = markContextUnread(ctx);
      if (result.ok) {
        if (forced[ctx] !== result.baseline) {
          forced[ctx] = result.baseline;
          anyNew = true;
        }
      } else {
        warn(
          `[useUnreadChannels] replay of local-only force failed (${result.reason}) — will retry on next read-state change`,
        );
      }
    }
  }
  return anyNew;
}
