/**
 * Tests for Slack-style search operators (desktop parity port).
 */

import { describe, expect, it } from "vitest";
import { isHexPubkey, parseSearchOperators } from "../lib/parse-search-operators";

describe("parseSearchOperators", () => {
  it("extracts from:/in: and leaves the FTS text", () => {
    const ops = parseSearchOperators("deploy failed from:@alice in:#backend");
    expect(ops.from).toBe("@alice");
    expect(ops.in).toBe("#backend");
    expect(ops.text).toBe("deploy failed");
  });

  it("parses after:/before: into unix seconds, before: exclusive of the named day", () => {
    const ops = parseSearchOperators("after:2026-07-01 before:2026-07-28 logs");
    expect(ops.since).toBe(Math.floor(new Date(2026, 6, 1).getTime() / 1000));
    expect(ops.until).toBe(Math.floor(new Date(2026, 6, 28).getTime() / 1000) - 1);
    expect(ops.text).toBe("logs");
  });

  it("keeps invalid dates in the text", () => {
    const ops = parseSearchOperators("after:yesterday deploy");
    expect(ops.since).toBeNull();
    expect(ops.text).toContain("after:yesterday");
  });

  it("does not treat mid-token colons as operators", () => {
    const ops = parseSearchOperators("https://x.com/in:foo built-in:react");
    expect(ops.in).toBeNull();
    expect(ops.from).toBeNull();
  });

  it("strips trailing punctuation from values", () => {
    expect(parseSearchOperators("in:general,").in).toBe("general");
  });

  it("later occurrences of the same operator win", () => {
    expect(parseSearchOperators("from:a from:b").from).toBe("b");
  });
});

describe("isHexPubkey", () => {
  it("accepts 64-char hex, rejects npub and short strings", () => {
    expect(isHexPubkey("a".repeat(64))).toBe(true);
    expect(isHexPubkey("npub1xyz")).toBe(false);
    expect(isHexPubkey("abc")).toBe(false);
  });
});
