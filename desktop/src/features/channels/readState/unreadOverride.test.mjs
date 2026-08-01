import assert from "node:assert/strict";
import test from "node:test";

import {
  OV_MAX,
  canonicalWireEntries,
  escapeFrontierKey,
  markReadRegister,
  markUnreadRegister,
  mergeOverrides,
  mergeRegister,
  overrideActive,
  planMarkUnread,
  splitContexts,
  unescapeFrontierKey,
} from "./unreadOverride.ts";

// ── escaping ─────────────────────────────────────────────────────────────────

test("escapeFrontierKey escapes ov_ and esc: prefixes only", () => {
  assert.equal(escapeFrontierKey("channel-1"), "channel-1");
  assert.equal(escapeFrontierKey("ov_weird"), "esc:ov_weird");
  assert.equal(escapeFrontierKey("esc:x"), "esc:esc:x");
});

test("unescapeFrontierKey strips exactly one esc: prefix", () => {
  assert.equal(unescapeFrontierKey("channel-1"), "channel-1");
  assert.equal(unescapeFrontierKey("esc:ov_weird"), "ov_weird");
  assert.equal(unescapeFrontierKey("esc:esc:x"), "esc:x");
});

// ── splitContexts — group-first validation ───────────────────────────────────

test("splitContexts accepts a complete live 3-key group", () => {
  const { frontier, overrides } = splitContexts({
    "channel-1": 100,
    "ov_s:channel-1": 2,
    "ov_c:channel-1": 1,
    "ov_b:channel-1": 100,
  });
  assert.deepEqual(frontier, { "channel-1": 100 });
  assert.deepEqual(overrides, { "channel-1": { s: 2, c: 1, b: 100 } });
});

test("splitContexts accepts an ov_c-only tombstone (zero-filled)", () => {
  const { overrides } = splitContexts({ "ov_c:ctx": 7 });
  assert.deepEqual(overrides, { ctx: { s: 0, c: 7, b: 0 } });
});

test("splitContexts rejects partial groups wholesale, keeps frontier", () => {
  const { frontier, overrides } = splitContexts({
    "channel-1": 100,
    "ov_s:channel-1": 2,
    "ov_b:channel-1": 100, // missing ov_c → invalid group
  });
  assert.deepEqual(frontier, { "channel-1": 100 });
  assert.deepEqual(overrides, {});
});

test("splitContexts rejects groups with non-u32 components", () => {
  for (const bad of [-1, 1.5, OV_MAX + 1, Number.NaN]) {
    const { overrides } = splitContexts({
      "ov_s:x": bad,
      "ov_c:x": 0,
      "ov_b:x": 0,
    });
    assert.deepEqual(overrides, {}, `value ${bad} must reject the group`);
  }
});

test("splitContexts drops unknown ov_ stems and unescapes frontier keys", () => {
  const { frontier, overrides } = splitContexts({
    ov_unknown: 5,
    "esc:ov_weird": 42,
  });
  assert.deepEqual(overrides, {});
  assert.deepEqual(frontier, { ov_weird: 42 });
});

// ── merge ────────────────────────────────────────────────────────────────────

test("mergeRegister / mergeOverrides are componentwise max", () => {
  assert.deepEqual(
    mergeRegister({ s: 3, c: 1, b: 50 }, { s: 2, c: 4, b: 60 }),
    { s: 3, c: 4, b: 60 },
  );
  const merged = mergeOverrides(
    { a: { s: 1, c: 0, b: 10 } },
    { a: { s: 0, c: 2, b: 5 }, b: { s: 1, c: 0, b: 1 } },
  );
  assert.deepEqual(merged, {
    a: { s: 1, c: 2, b: 10 },
    b: { s: 1, c: 0, b: 1 },
  });
});

// ── liveness (clear-wins) ────────────────────────────────────────────────────

test("overrideActive: live requires s>0, frontier<=b, s>c (clear wins ties)", () => {
  assert.equal(overrideActive({ s: 1, c: 0, b: 100 }, 100), true);
  assert.equal(overrideActive({ s: 1, c: 0, b: 100 }, 101), false); // frontier advanced
  assert.equal(overrideActive({ s: 1, c: 1, b: 100 }, 100), false); // tie → cleared
  assert.equal(overrideActive({ s: 0, c: 0, b: 0 }, 0), false); // virgin
});

// ── actions ──────────────────────────────────────────────────────────────────

test("markUnreadRegister: S=max(S,C)+1, B=frontier; refuses at ceiling", () => {
  assert.deepEqual(markUnreadRegister(undefined, 100), { s: 1, c: 0, b: 100 });
  assert.deepEqual(markUnreadRegister({ s: 1, c: 3, b: 50 }, 200), {
    s: 4,
    c: 3,
    b: 200,
  });
  assert.equal(markUnreadRegister({ s: OV_MAX, c: 0, b: 0 }, 1), null);
});

test("planMarkUnread folds local markers into the baseline", () => {
  const plan = planMarkUnread({}, { ctx: 100 }, { ctx: 150 }, "ctx");
  assert.ok(plan);
  assert.deepEqual(plan.register, { s: 1, c: 0, b: 150 });
});

test("markReadRegister: C=max(S,C)+1; virgin passthrough; ceiling refused", () => {
  assert.deepEqual(markReadRegister({ s: 2, c: 0, b: 10 }), {
    s: 2,
    c: 3,
    b: 10,
  });
  const virgin = { s: 0, c: 0, b: 0 };
  assert.equal(markReadRegister(virgin), virgin);
  assert.equal(markReadRegister({ s: OV_MAX, c: 1, b: 0 }), null);
});

// ── canonical publication ────────────────────────────────────────────────────

test("canonicalWireEntries: live → 3 keys, dead → tombstone, virgin → omitted", () => {
  const wire = canonicalWireEntries(
    {
      live: { s: 2, c: 1, b: 100 },
      dead: { s: 2, c: 2, b: 100 },
      virgin: { s: 0, c: 0, b: 0 },
    },
    { live: 100, dead: 100 },
  );
  assert.deepEqual(wire, {
    "ov_s:live": 2,
    "ov_c:live": 1,
    "ov_b:live": 100,
    "ov_c:dead": 2,
  });
});

test("canonicalWireEntries: frontier past baseline demotes to tombstone", () => {
  const wire = canonicalWireEntries(
    { ctx: { s: 3, c: 1, b: 100 } },
    { ctx: 101 },
  );
  assert.deepEqual(wire, { "ov_c:ctx": 3 });
});
