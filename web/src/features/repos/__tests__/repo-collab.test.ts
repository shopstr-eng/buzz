/**
 * Tests for NIP-34 collaboration primitives: status resolution trust rules,
 * same-second monotonic ordering, and trusted-author filtering (the desktop
 * parity rules for PR updates).
 */

import { describe, expect, it } from "vitest";
import {
  filterTrustedAuthors,
  issueStatusFromKind,
  monotonicCreatedAt,
  prStatusFromKind,
  resolveStatusKind,
  rootIdOf,
  KIND_STATUS_CLOSED,
  KIND_STATUS_OPEN,
  KIND_STATUS_RESOLVED,
  type RootStatusEvent,
} from "../repo-collab";
import type { NostrEvent } from "@/shared/lib/relay-connection";

const AUTHOR = "a".repeat(64);
const OWNER = "b".repeat(64);
const RANDO = "c".repeat(64);

function statusEv(id: string, rootId: string, kind: number, pubkey: string, createdAt: number): RootStatusEvent {
  return { id, rootId, kind, pubkey, createdAt };
}

describe("resolveStatusKind", () => {
  it("ignores status events from untrusted signers", () => {
    const events = [
      statusEv("01", "root", KIND_STATUS_CLOSED, RANDO, 200),
      statusEv("02", "root", KIND_STATUS_OPEN, AUTHOR, 100),
    ];
    expect(resolveStatusKind(events, new Set([AUTHOR, OWNER]))).toBe(KIND_STATUS_OPEN);
  });

  it("latest created_at wins among trusted signers", () => {
    const events = [
      statusEv("01", "root", KIND_STATUS_OPEN, AUTHOR, 100),
      statusEv("02", "root", KIND_STATUS_CLOSED, OWNER, 200),
    ];
    expect(resolveStatusKind(events, new Set([AUTHOR, OWNER]))).toBe(KIND_STATUS_CLOSED);
  });

  it("breaks same-second ties deterministically by event id", () => {
    const mk = (first: string, second: string) => [
      statusEv(first, "root", KIND_STATUS_OPEN, AUTHOR, 100),
      statusEv(second, "root", KIND_STATUS_CLOSED, OWNER, 100),
    ];
    // Regardless of delivery order, the lexicographically larger id wins.
    expect(resolveStatusKind(mk("0a", "0b"), new Set([AUTHOR, OWNER]))).toBe(KIND_STATUS_CLOSED);
    expect(resolveStatusKind(mk("0b", "0a"), new Set([AUTHOR, OWNER]))).toBe(KIND_STATUS_OPEN);
  });

  it("returns null when no trusted events exist", () => {
    expect(resolveStatusKind([statusEv("01", "root", KIND_STATUS_CLOSED, RANDO, 1)], new Set([AUTHOR]))).toBeNull();
  });
});

describe("filterTrustedAuthors", () => {
  it("drops updates from untrusted signers", () => {
    const updates = [
      { pubkey: AUTHOR, v: 1 },
      { pubkey: RANDO, v: 2 },
      { pubkey: OWNER, v: 3 },
    ];
    expect(filterTrustedAuthors(updates, new Set([AUTHOR, OWNER])).map((u) => u.v)).toEqual([1, 3]);
  });
});

describe("monotonicCreatedAt", () => {
  it("bumps one second past the last known status when now is not later", () => {
    const farFuture = Math.floor(Date.now() / 1000) + 100;
    expect(monotonicCreatedAt(farFuture)).toBe(farFuture + 1);
  });

  it("uses now when it is already later than the last known status", () => {
    expect(monotonicCreatedAt(1)).toBeGreaterThan(1);
  });

  it("uses now when nothing is known", () => {
    expect(monotonicCreatedAt(null)).toBeGreaterThan(0);
  });
});

describe("status label mapping", () => {
  it("maps kinds to issue statuses with label heuristic fallback", () => {
    expect(issueStatusFromKind(KIND_STATUS_RESOLVED, [])).toBe("done");
    expect(issueStatusFromKind(KIND_STATUS_CLOSED, [])).toBe("closed");
    expect(issueStatusFromKind(null, ["triage"])).toBe("triage");
    expect(issueStatusFromKind(null, [])).toBe("open");
  });

  it("maps kinds to PR statuses with draft label fallback", () => {
    expect(prStatusFromKind(KIND_STATUS_RESOLVED, [])).toBe("merged");
    expect(prStatusFromKind(null, ["draft"])).toBe("draft");
    expect(prStatusFromKind(null, [])).toBe("open");
  });
});

describe("rootIdOf", () => {
  function ev(tags: string[][]): NostrEvent {
    return { id: "x", pubkey: AUTHOR, kind: 1, created_at: 0, tags, content: "", sig: "" } as NostrEvent;
  }

  it("prefers the e tag marked root", () => {
    expect(rootIdOf(ev([["e", "reply-to"], ["e", "the-root", "", "root"]]))).toBe("the-root");
  });

  it("falls back to the first e/E tag", () => {
    expect(rootIdOf(ev([["E", "pr-root"]]))).toBe("pr-root");
    expect(rootIdOf(ev([["p", "someone"]]))).toBeNull();
  });
});
