import assert from "node:assert/strict";
import test from "node:test";

import { ReadStateManager } from "./readStateManager.ts";
import { readStoredOverrides } from "./readStateStorage.ts";

// Browser globals required by ReadStateManager (same pattern as
// readStateManager.test.mjs).
function makeLocalStorage() {
  const store = new Map();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, value),
    removeItem: (key) => store.delete(key),
  };
}

{
  const ls = makeLocalStorage();
  if (typeof globalThis.window === "undefined") {
    globalThis.window = {
      localStorage: ls,
      clearTimeout: (id) => clearTimeout(id),
      setTimeout: (fn, ms) => setTimeout(fn, ms),
    };
  } else {
    globalThis.window.localStorage = ls;
    if (!globalThis.window.clearTimeout) {
      globalThis.window.clearTimeout = (id) => clearTimeout(id);
      globalThis.window.setTimeout = (fn, ms) => setTimeout(fn, ms);
    }
  }
  Object.defineProperty(globalThis, "localStorage", {
    get: () => globalThis.window.localStorage,
    configurable: true,
  });
}

const PUBKEY = "c".repeat(64);

function makeFakeRelay() {
  return {
    fetchEvents: async () => [],
    publishEvent: async () => {},
    subscribeLive: async () => () => {},
  };
}

async function makeInitializedManager() {
  globalThis.window.localStorage = makeLocalStorage();
  const mgr = new ReadStateManager(PUBKEY, makeFakeRelay());
  await mgr.initialize();
  return mgr;
}

test("markContextUnread fails visibly with not-ready before full-state load", () => {
  globalThis.window.localStorage = makeLocalStorage();
  const mgr = new ReadStateManager(PUBKEY, makeFakeRelay());
  const result = mgr.markContextUnread("channel-1");
  assert.deepEqual(result, { ok: false, reason: "not-ready" });
  mgr.destroy();
});

test("markContextUnread after load: live register, baseline = effective frontier", async () => {
  const mgr = await makeInitializedManager();
  mgr.markContextRead("channel-1", 500);

  const result = mgr.markContextUnread("channel-1");
  assert.equal(result.ok, true);
  assert.equal(result.baseline, 500);
  assert.equal(mgr.getOverrideStatus("channel-1"), "active");
  assert.deepEqual(mgr.getActiveOverrides(), { "channel-1": 500 });

  // Canonical wire entries carry the full live group.
  const wire = mgr.currentOverrideWire();
  assert.deepEqual(wire, {
    "ov_s:channel-1": 1,
    "ov_c:channel-1": 0,
    "ov_b:channel-1": 500,
  });
  mgr.destroy();
});

test("markContextManualRead increments ov_c and deactivates the force", async () => {
  const mgr = await makeInitializedManager();
  mgr.markContextRead("channel-1", 500);
  assert.equal(mgr.markContextUnread("channel-1").ok, true);

  mgr.markContextManualRead("channel-1");
  assert.equal(mgr.getOverrideStatus("channel-1"), "inactive");
  assert.deepEqual(mgr.getActiveOverrides(), {});
  // Dead register publishes as a tombstone floor.
  assert.deepEqual(mgr.currentOverrideWire(), { "ov_c:channel-1": 2 });
  mgr.destroy();
});

test("frontier advance past baseline deactivates the force (implicit read)", async () => {
  const mgr = await makeInitializedManager();
  mgr.markContextRead("channel-1", 500);
  assert.equal(mgr.markContextUnread("channel-1").ok, true);

  mgr.markContextRead("channel-1", 501);
  assert.equal(mgr.getOverrideStatus("channel-1"), "inactive");
  assert.deepEqual(mgr.currentOverrideWire(), { "ov_c:channel-1": 1 });
  mgr.destroy();
});

test("overrides persist across manager instances (durable storage)", async () => {
  const mgr = await makeInitializedManager();
  mgr.markContextRead("channel-1", 500);
  assert.equal(mgr.markContextUnread("channel-1").ok, true);
  mgr.destroy();

  assert.deepEqual(readStoredOverrides(PUBKEY), {
    "channel-1": { s: 1, c: 0, b: 500 },
  });

  // Same localStorage, fresh manager: register hydrates and stays active.
  const mgr2 = new ReadStateManager(PUBKEY, makeFakeRelay());
  await mgr2.initialize();
  mgr2.markContextRead("channel-1", 500); // same marker, no advance
  assert.equal(mgr2.getOverrideStatus("channel-1"), "active");
  mgr2.destroy();
});

test("publish sends escaped frontier + canonical ov_* entries to the primary slot", async () => {
  const mgr = await makeInitializedManager();
  mgr.markContextRead("channel-1", 500);
  mgr.markContextRead("ov_weird-channel", 400);
  assert.equal(mgr.markContextUnread("channel-1").ok, true);

  const published = [];
  mgr.publishOneSlot = async (slotId, contexts, overrideWire) => {
    published.push({ slotId, contexts, overrideWire });
  };
  await mgr.publish();

  assert.equal(published.length, 1);
  assert.deepEqual(published[0].overrideWire, {
    "ov_s:channel-1": 1,
    "ov_c:channel-1": 0,
    "ov_b:channel-1": 500,
  });
  // publishOneSlot receives RAW frontier keys (escaping happens inside);
  // the raw ov_-prefixed channel id must still be present.
  assert.equal(published[0].contexts["ov_weird-channel"], 400);
  mgr.destroy();
});

test("split mode: override-only change publishes the primary slot despite unchanged frontier", async () => {
  const mgr = await makeInitializedManager();

  // Enough channel keys to exceed the 32KB single-slot budget → split mode.
  const ts = 1_000_000;
  for (let i = 0; i < 700; i++) {
    mgr.markContextRead(`channel-${i.toString().padStart(64, "0")}`, ts);
  }
  assert.equal(mgr.currentContexts(), null, "precondition: split mode");

  const published = [];
  mgr.publishOneSlot = async (slotId, contexts, overrideWire = null) => {
    published.push({ slotId, overrideWire });
    for (const [key, tsVal] of Object.entries(contexts)) {
      mgr.lastPublishedContexts[key] = tsVal;
    }
    if (overrideWire !== null) {
      mgr.lastPublishedOverrideWire = { ...overrideWire };
    }
  };

  await mgr.publish();
  const callsAfterFirst = published.length;
  assert.ok(callsAfterFirst > 1, "first split publish covers multiple slots");

  // Unchanged everything → suppressed.
  await mgr.publish();
  assert.equal(published.length, callsAfterFirst, "no-op must be suppressed");

  // Override-only mutation: frontier unchanged, ov_* wire changed → publish.
  const target = `channel-${(0).toString().padStart(64, "0")}`;
  assert.equal(mgr.markContextUnread(target).ok, true);
  await mgr.publish();
  assert.ok(
    published.length > callsAfterFirst,
    "override-only change must break split-mode suppression",
  );
  const primary = published
    .slice(callsAfterFirst)
    .find((p) => p.overrideWire !== null);
  assert.ok(primary, "primary slot must carry the override wire");
  assert.equal(primary.overrideWire[`ov_s:${target}`], 1);
  mgr.destroy();
});

test("no-op suppression fires only when frontier AND override wire are unchanged", async () => {
  const mgr = await makeInitializedManager();
  mgr.markContextRead("channel-1", 500);

  let calls = 0;
  mgr.publishOneSlot = async (_slotId, contexts, overrideWire) => {
    calls += 1;
    for (const [key, ts] of Object.entries(contexts)) {
      mgr.lastPublishedContexts[key] = ts;
    }
    if (overrideWire !== null) {
      mgr.lastPublishedOverrideWire = { ...overrideWire };
    }
  };

  await mgr.publish();
  assert.equal(calls, 1);
  await mgr.publish();
  assert.equal(calls, 1, "unchanged state must suppress the second publish");

  // An override change alone must break suppression.
  assert.equal(mgr.markContextUnread("channel-1").ok, true);
  await mgr.publish();
  assert.equal(calls, 2, "override change must trigger a publish");
  mgr.destroy();
});

test("isLoadComplete: false before load, true after successful full-state load", async () => {
  globalThis.window.localStorage = makeLocalStorage();
  const mgr = new ReadStateManager(PUBKEY, makeFakeRelay());
  assert.equal(mgr.isLoadComplete(), false);
  await mgr.initialize();
  assert.equal(mgr.isLoadComplete(), true);
  mgr.destroy();
});
