import { describe, it, expect } from "vitest";
import { buildSlot } from "../lib/read-state-sync";
import {
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
  OV_MAX,
} from "../lib/unread-override";

describe("planMarkUnread (baseline from the full effective frontier)", () => {
  it("baseline includes the fresh local marker when the wire frontier is stale", () => {
    // Local read marker advanced to 500 but the merged wire frontier still
    // says 100 (debounce window). A baseline of 100 would make the register
    // dead on arrival (F=500 > B=100) — only a tombstone would publish.
    const plan = planMarkUnread({}, { chan: 100 }, { chan: 500 }, "chan");
    expect(plan).not.toBeNull();
    expect(plan!.register.b).toBe(500);
    const wire = canonicalWireEntries(plan!.overrides, plan!.frontier);
    // Live group, NOT a tombstone: all three keys present.
    expect(wire["ov_s:chan"]).toBe(1);
    expect(wire["ov_c:chan"]).toBe(0);
    expect(wire["ov_b:chan"]).toBe(500);
    // A remote device merging this blob yields an ACTIVE override.
    const { overrides, frontier } = splitContexts(wire);
    expect(overrideActive(overrides["chan"], frontier["chan"] ?? 0)).toBe(true);
  });

  it("frontier max-merge never lowers a higher wire frontier", () => {
    const plan = planMarkUnread({}, { chan: 500 }, { chan: 100 }, "chan");
    expect(plan!.register.b).toBe(500);
    expect(plan!.frontier["chan"]).toBe(500);
  });

  it("refuses at the counter ceiling", () => {
    const exhausted = { chan: { s: OV_MAX, c: 0, b: 1 } };
    expect(planMarkUnread(exhausted, { chan: 1 }, {}, "chan")).toBeNull();
  });
});

describe("escape/unescape bijection (NIP-RS Reserved Namespace)", () => {
  it("escapes raw ids starting with ov_ or esc:", () => {
    expect(escapeFrontierKey("ov_s:evil")).toBe("esc:ov_s:evil");
    expect(escapeFrontierKey("esc:foo")).toBe("esc:esc:foo");
    expect(escapeFrontierKey("chan-1")).toBe("chan-1");
    expect(escapeFrontierKey("msg:x")).toBe("msg:x");
  });

  it("strips exactly one esc: prefix on receive", () => {
    expect(unescapeFrontierKey("esc:ov_s:evil")).toBe("ov_s:evil");
    expect(unescapeFrontierKey("esc:esc:foo")).toBe("esc:foo");
    expect(unescapeFrontierKey("chan-1")).toBe("chan-1");
  });

  it("escape→unescape is the identity", () => {
    for (const raw of ["ov_s:evil", "esc:foo", "chan-1", "ov_", "esc:"]) {
      expect(unescapeFrontierKey(escapeFrontierKey(raw))).toBe(raw);
    }
  });
});

describe("splitContexts — group-first validation", () => {
  it("accepts a complete live 3-key group (with legitimate zero ov_c)", () => {
    const { overrides } = splitContexts({ "ov_s:c1": 2, "ov_c:c1": 0, "ov_b:c1": 100 });
    expect(overrides.c1).toEqual({ s: 2, c: 0, b: 100 });
  });

  it("accepts a tombstone floor (ov_c only)", () => {
    const { overrides } = splitContexts({ "ov_c:c1": 3 });
    expect(overrides.c1).toEqual({ s: 0, c: 3, b: 0 });
  });

  it("rejects partial groups wholesale but retains the frontier entry", () => {
    const { frontier, overrides } = splitContexts({
      "ov_s:c1": 1,
      "ov_b:c1": 5, // missing ov_c
      c1: 10,
    });
    expect(overrides.c1).toBeUndefined();
    expect(frontier.c1).toBe(10);
  });

  it("rejects groups with non-uint32 values", () => {
    for (const bad of [-1, 1.5, OV_MAX + 1]) {
      const { overrides } = splitContexts({ "ov_s:c1": 1, "ov_c:c1": 1, "ov_b:c1": bad });
      expect(overrides.c1).toBeUndefined();
    }
  });

  it("rejects groups with extra components (s+b, no c)", () => {
    const { overrides } = splitContexts({ "ov_s:c1": 1, "ov_b:c1": 1 });
    expect(overrides.c1).toBeUndefined();
  });

  it("drops unknown ov_ stems entirely", () => {
    const { frontier, overrides } = splitContexts({ "ov_x:c1": 1, c1: 5 });
    expect(overrides.c1).toBeUndefined();
    expect(frontier).toEqual({ c1: 5 });
  });

  it("unescapes frontier keys and groups by RAW ctx (unescape-before-group)", () => {
    // Raw ctx "ov_s:evil": frontier wire key esc:ov_s:evil, override siblings
    // keyed by the RAW suffix — both must resolve to the same logical ctx.
    const { frontier, overrides } = splitContexts({
      "esc:ov_s:evil": 100,
      "ov_s:ov_s:evil": 1,
      "ov_c:ov_s:evil": 0,
      "ov_b:ov_s:evil": 100,
    });
    expect(frontier["ov_s:evil"]).toBe(100);
    expect(overrides["ov_s:evil"]).toEqual({ s: 1, c: 0, b: 100 });
  });

  it("drops non-positive frontier values", () => {
    const { frontier } = splitContexts({ c1: 0, c2: -3, c3: 7 });
    expect(frontier).toEqual({ c3: 7 });
  });
});

describe("merge + liveness (clear-wins)", () => {
  it("merges componentwise max", () => {
    expect(mergeRegister({ s: 1, c: 0, b: 5 }, { s: 0, c: 3, b: 0 })).toEqual({ s: 1, c: 3, b: 5 });
    expect(mergeOverrides({ a: { s: 1, c: 0, b: 5 } }, { a: { s: 0, c: 2, b: 0 } })).toEqual({
      a: { s: 1, c: 2, b: 5 },
    });
  });

  it("override_active requires S>0, F<=B, S>C", () => {
    const reg = { s: 1, c: 0, b: 10 };
    expect(overrideActive(reg, 10)).toBe(true);
    expect(overrideActive(reg, 11)).toBe(false); // frontier advanced past baseline
    expect(overrideActive({ s: 0, c: 1, b: 0 }, 0)).toBe(false); // tombstone
    expect(overrideActive({ s: 1, c: 1, b: 10 }, 10)).toBe(false); // tie — clear wins
  });
});

describe("actions", () => {
  it("mark-unread increments S to max(S,C)+1 and sets B to the frontier", () => {
    expect(markUnreadRegister(undefined, 42)).toEqual({ s: 1, c: 0, b: 42 });
    expect(markUnreadRegister({ s: 1, c: 3, b: 9 }, 42)).toEqual({ s: 4, c: 3, b: 42 });
  });

  it("mark-unread refuses at the uint32 ceiling (no wrap)", () => {
    expect(markUnreadRegister({ s: OV_MAX, c: 0, b: 1 }, 5)).toBeNull();
    expect(markUnreadRegister({ s: 0, c: OV_MAX, b: 0 }, 5)).toBeNull();
  });

  it("explicit mark-read increments C to max(S,C)+1, S/B unchanged", () => {
    expect(markReadRegister({ s: 2, c: 0, b: 7 })).toEqual({ s: 2, c: 3, b: 7 });
    expect(markReadRegister({ s: 0, c: 0, b: 0 })).toEqual({ s: 0, c: 0, b: 0 });
    expect(markReadRegister({ s: OV_MAX, c: 0, b: 1 })).toBeNull();
  });
});

describe("canonicalWireEntries — mandatory canonical publication", () => {
  it("live override publishes all three keys unchanged", () => {
    expect(canonicalWireEntries({ c1: { s: 1, c: 0, b: 10 } }, { c1: 10 })).toEqual({
      "ov_s:c1": 1,
      "ov_c:c1": 0,
      "ov_b:c1": 10,
    });
  });

  it("dead override compacts to the tombstone floor ov_c = max(S,C)", () => {
    expect(canonicalWireEntries({ c1: { s: 3, c: 5, b: 10 } }, { c1: 10 })).toEqual({
      "ov_c:c1": 5,
    });
    // dead because the frontier advanced past B
    expect(canonicalWireEntries({ c1: { s: 1, c: 0, b: 10 } }, { c1: 11 })).toEqual({
      "ov_c:c1": 1,
    });
  });

  it("virgin registers are omitted", () => {
    expect(canonicalWireEntries({ c1: { s: 0, c: 0, b: 0 } }, {})).toEqual({});
  });
});

describe("buildSlot with overrides", () => {
  it("escapes frontier keys and carries ov_* entries", () => {
    const { json, fits } = buildSlot(
      "cid",
      { "ov_s:evil": 100, "chan-1": 5 },
      { "ov_s:chan-1": 1, "ov_c:chan-1": 0, "ov_b:chan-1": 5 },
    );
    expect(fits).toBe(true);
    const parsed = JSON.parse(json) as { contexts: Record<string, number> };
    expect(parsed.contexts["esc:ov_s:evil"]).toBe(100);
    expect(parsed.contexts["ov_s:chan-1"]).toBe(1);
  });

  it("evicts frontier entries (incl. msg:/thread:) but NEVER ov_* entries", () => {
    const frontier: Record<string, number> = { "msg:keep": 1 };
    for (let i = 0; i < 60; i++) frontier[`chan-${String(i).padStart(3, "0")}`] = i;
    const ov = { "ov_s:c": 1, "ov_c:c": 0, "ov_b:c": 5 };
    // Tight budget: all bare markers pruned first, then msg:/thread: must go
    // (84 bytes with msg:keep > 80; 71 without fits).
    const { json, fits } = buildSlot("cid", frontier, ov, 80);
    expect(fits).toBe(true);
    const parsed = JSON.parse(json) as { contexts: Record<string, number> };
    expect(parsed.contexts["ov_s:c"]).toBe(1);
    expect(parsed.contexts["ov_b:c"]).toBe(5);
    // msg:/thread: evicted under pressure, after bare channel markers
    expect(parsed.contexts["msg:keep"]).toBeUndefined();
  });

  it("reports fits=false when ov_* entries alone exceed the budget", () => {
    const ov: Record<string, number> = {};
    for (let i = 0; i < 50; i++) ov[`ov_c:tombstone-context-${i}`] = 1;
    const { fits } = buildSlot("cid", { "chan-1": 5 }, ov, 200);
    expect(fits).toBe(false);
  });
});
