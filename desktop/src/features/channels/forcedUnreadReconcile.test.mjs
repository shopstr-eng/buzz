import assert from "node:assert/strict";
import test from "node:test";

import { reconcileForcedUnread } from "./forcedUnreadReconcile.ts";

// Fake read-state deps for the pure reconcile step. Defaults model a fully
// loaded manager with no overrides and no synced advances; tests override
// the pieces they care about and record markContextUnread calls.
function makeReadState(overrides = {}) {
  const calls = [];
  const readState = {
    drainSyncedAdvances: () => new Set(),
    getOverrideStatus: () => "none",
    getActiveOverrides: () => ({}),
    isLoadComplete: () => true,
    getOwnTimestamp: () => null,
    markContextUnread: (ctx) => {
      calls.push(ctx);
      return { ok: true, baseline: 500 };
    },
    ...overrides,
  };
  return { readState, calls };
}

test("replay: pending local-only force is replayed as an override and mirrors the returned baseline", () => {
  // baseline = 500 (marker at force time) and own marker still 500: the
  // frontier has NOT advanced past the force, so it must be replayed.
  const forced = { "channel-1": 500 };
  const { readState, calls } = makeReadState({
    getOwnTimestamp: () => 500,
  });

  const changed = reconcileForcedUnread(forced, readState);
  assert.deepEqual(calls, ["channel-1"]);
  assert.equal(changed, false, "baseline already matched — no persist needed");
  assert.deepEqual(forced, { "channel-1": 500 });
});

test("replay: force with null baseline and no own marker replays and adopts the register baseline", () => {
  const forced = { "channel-1": null };
  const { readState, calls } = makeReadState({
    markContextUnread: (ctx) => {
      calls.push(ctx);
      return { ok: true, baseline: 750 };
    },
  });

  const changed = reconcileForcedUnread(forced, readState);
  assert.deepEqual(calls, ["channel-1"]);
  assert.equal(changed, true);
  assert.deepEqual(forced, { "channel-1": 750 });
});

test("replay: frontier advanced past the force-time baseline drops the force (no resurrection)", () => {
  // The user read this channel on another device after forcing it unread
  // offline here: own marker (900) > baseline (500). The cross-device read
  // wins — the force must be dropped, NOT replayed.
  const forced = { "channel-1": 500 };
  const { readState, calls } = makeReadState({
    getOwnTimestamp: () => 900,
  });

  const changed = reconcileForcedUnread(forced, readState);
  assert.deepEqual(calls, [], "must not resurrect via markContextUnread");
  assert.equal(changed, true);
  assert.deepEqual(forced, {}, "force must be dropped");
});

test("replay: null baseline with any own marker counts as covered and is dropped", () => {
  // Legacy entries store null when no marker existed at force time. Any
  // later read (own > 0) covers such a force.
  const forced = { "channel-1": null };
  const { readState, calls } = makeReadState({
    getOwnTimestamp: () => 1,
  });

  const changed = reconcileForcedUnread(forced, readState);
  assert.deepEqual(calls, []);
  assert.equal(changed, true);
  assert.deepEqual(forced, {});
});

test("replay: failure keeps the force so the next read-state change retries", () => {
  const forced = { "channel-1": 500 };
  const warnings = [];
  const { readState, calls } = makeReadState({
    getOwnTimestamp: () => 500,
    markContextUnread: (ctx) => {
      calls.push(ctx);
      return { ok: false, reason: "counter-ceiling" };
    },
  });

  const changed = reconcileForcedUnread(forced, readState, (msg) =>
    warnings.push(msg),
  );
  assert.deepEqual(calls, ["channel-1"]);
  assert.equal(changed, false);
  assert.deepEqual(forced, { "channel-1": 500 }, "force must survive failure");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /counter-ceiling/);

  // Next read-state change: replay succeeds and the baseline is mirrored.
  readState.markContextUnread = (ctx) => {
    calls.push(ctx);
    return { ok: true, baseline: 500 };
  };
  const changed2 = reconcileForcedUnread(forced, readState, (msg) =>
    warnings.push(msg),
  );
  assert.deepEqual(calls, ["channel-1", "channel-1"], "retried on next pass");
  assert.equal(changed2, false, "baseline unchanged — no extra persist");
  assert.deepEqual(forced, { "channel-1": 500 });
  assert.equal(warnings.length, 1, "no new warning on success");
});

test("replay: gated until the full-state load has proven complete", () => {
  const forced = { "channel-1": 500 };
  const { readState, calls } = makeReadState({
    isLoadComplete: () => false,
  });

  const changed = reconcileForcedUnread(forced, readState);
  assert.deepEqual(calls, [], "must not replay before load completes");
  assert.equal(changed, false);
  assert.deepEqual(forced, { "channel-1": 500 }, "force preserved for later");
});

test("replay: entries that already have an ov_* register are not replayed", () => {
  const forced = { "channel-1": 500 };
  const { readState, calls } = makeReadState({
    getOverrideStatus: () => "active",
    getActiveOverrides: () => ({ "channel-1": 500 }),
  });

  const changed = reconcileForcedUnread(forced, readState);
  assert.deepEqual(calls, [], "register exists — no replay");
  assert.equal(changed, false);
});

test("replay: msg:/thread: contexts are never replayed as channel overrides", () => {
  const forced = { "msg:abc": 500, "thread:def": 500 };
  const { readState, calls } = makeReadState({});

  const changed = reconcileForcedUnread(forced, readState);
  assert.deepEqual(calls, []);
  assert.equal(changed, false);
  assert.deepEqual(forced, { "msg:abc": 500, "thread:def": 500 });
});

test("drain: a synced advance clears a legacy local-only force before replay", () => {
  // Cross-device read arrives in the same pass: the advance drains first and
  // deletes the force, so the replay loop never sees it.
  const forced = { "channel-1": 500 };
  const { readState, calls } = makeReadState({
    drainSyncedAdvances: () => new Set(["channel-1"]),
    getOwnTimestamp: () => 900,
  });

  const changed = reconcileForcedUnread(forced, readState);
  assert.deepEqual(calls, []);
  assert.equal(changed, true);
  assert.deepEqual(forced, {});
});

test("drain: a synced advance does NOT clear a force backed by an active register", () => {
  const forced = { "channel-1": 500 };
  const { readState, calls } = makeReadState({
    drainSyncedAdvances: () => new Set(["channel-1"]),
    getOverrideStatus: () => "active",
    getActiveOverrides: () => ({ "channel-1": 500 }),
  });

  const changed = reconcileForcedUnread(forced, readState);
  assert.deepEqual(calls, []);
  assert.equal(changed, false);
  assert.deepEqual(forced, { "channel-1": 500 });
});

test("mirror: an active override set on another device lights the local force", () => {
  const forced = {};
  const { readState } = makeReadState({
    getOverrideStatus: (ctx) => (ctx === "channel-1" ? "active" : "none"),
    getActiveOverrides: () => ({ "channel-1": 640, "thread:xyz": 100 }),
  });

  const changed = reconcileForcedUnread(forced, readState);
  assert.equal(changed, true);
  assert.deepEqual(
    forced,
    { "channel-1": 640 },
    "channel mirrored; thread override ignored",
  );
});

test("mirror: an inactive register releases the local force", () => {
  const forced = { "channel-1": 500 };
  const { readState, calls } = makeReadState({
    getOverrideStatus: () => "inactive",
  });

  const changed = reconcileForcedUnread(forced, readState);
  assert.deepEqual(calls, [], "inactive register — never replayed either");
  assert.equal(changed, true);
  assert.deepEqual(forced, {});
});
