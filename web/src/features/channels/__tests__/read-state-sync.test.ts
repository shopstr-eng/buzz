import { describe, it, expect } from "vitest";
import {
  buildSlotPlaintext,
  channelMarkers,
  mergeContexts,
  parseSlotJson,
} from "../lib/read-state-sync";

describe("parseSlotJson", () => {
  it("accepts the desktop shape", () => {
    const slot = parseSlotJson(
      JSON.stringify({ v: 1, client_id: "uuid", contexts: { "chan-1": 100, "msg:x": 200 } }),
    );
    expect(slot?.client_id).toBe("uuid");
    expect(slot?.contexts).toEqual({ "chan-1": 100, "msg:x": 200 });
  });

  it("rejects wrong version / missing fields / invalid JSON", () => {
    expect(parseSlotJson('{"v":2,"client_id":"x","contexts":{}}')).toBeNull();
    expect(parseSlotJson('{"v":1,"contexts":{}}')).toBeNull();
    expect(parseSlotJson('{"v":1,"client_id":"x","contexts":[]}')).toBeNull();
    expect(parseSlotJson("not json")).toBeNull();
  });

  it("drops non-positive / non-numeric context values", () => {
    const slot = parseSlotJson(
      JSON.stringify({ v: 1, client_id: "x", contexts: { a: 5, b: -1, c: "zzz", d: 0 } }),
    );
    expect(slot?.contexts).toEqual({ a: 5 });
  });
});

describe("mergeContexts", () => {
  it("keeps the max per key (monotonic)", () => {
    expect(mergeContexts({ a: 10, b: 5 }, { a: 3, b: 9, c: 1 })).toEqual({ a: 10, b: 9, c: 1 });
  });
});

describe("channelMarkers", () => {
  it("excludes msg:/thread: prefixed keys", () => {
    expect(channelMarkers({ "chan-1": 1, "msg:x": 2, "thread:y": 3 })).toEqual([["chan-1", 1]]);
  });
});

describe("buildSlotPlaintext", () => {
  it("passes through when within budget", () => {
    const json = buildSlotPlaintext("cid", { "chan-1": 1 });
    expect(JSON.parse(json)).toEqual({ v: 1, client_id: "cid", contexts: { "chan-1": 1 } });
  });

  it("prunes oldest channel markers first, never msg:/thread: keys", () => {
    const contexts: Record<string, number> = { "msg:keep": 1 };
    for (let i = 0; i < 60; i++) contexts[`chan-${String(i).padStart(3, "0")}`] = i;
    const json = buildSlotPlaintext("cid", contexts, 400);
    expect(json.length).toBeLessThanOrEqual(400);
    const parsed = JSON.parse(json) as { contexts: Record<string, number> };
    expect(parsed.contexts["msg:keep"]).toBe(1);
    const kept = Object.keys(parsed.contexts).filter((k) => !k.startsWith("msg:"));
    // Oldest pruned first: surviving channel markers are the newest ones.
    for (const k of kept) expect(parsed.contexts[k]).toBeGreaterThanOrEqual(parsed.contexts[kept[0]]);
  });
});
