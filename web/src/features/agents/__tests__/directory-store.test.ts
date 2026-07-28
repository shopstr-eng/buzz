/**
 * Reconciliation semantics for the agent directory store: NIP-33 replaceable
 * resolution with deterministic (created_at, id) tie-breaks, plus kind-5
 * tombstone suppression across out-of-order replay.
 */

import { describe, it, expect } from "vitest";
import { DirectoryStore } from "../directory-store";

describe("DirectoryStore.put", () => {
  it("keeps the newest snapshot", () => {
    const s = new DirectoryStore<string>();
    s.put("a", 100, "id1", "old");
    expect(s.put("a", 200, "id2", "new")).toBe(true);
    expect(s.values()).toEqual(["new"]);
    expect(s.put("a", 150, "id3", "stale")).toBe(false);
    expect(s.values()).toEqual(["new"]);
  });

  it("breaks same-second ties by larger event id (relay semantics)", () => {
    const s = new DirectoryStore<string>();
    s.put("a", 100, "fff", "larger-id");
    expect(s.put("a", 100, "aaa", "smaller-id")).toBe(false);
    expect(s.values()).toEqual(["larger-id"]);
    expect(s.put("a", 100, "zzz", "even-larger")).toBe(true);
    expect(s.values()).toEqual(["even-larger"]);
  });

  it("tracks independent d-tags separately", () => {
    const s = new DirectoryStore<string>();
    s.put("a", 100, "id1", "A");
    s.put("b", 50, "id2", "B");
    expect(s.values().sort()).toEqual(["A", "B"]);
  });
});

describe("DirectoryStore.tombstone", () => {
  it("evicts the addressed snapshot", () => {
    const s = new DirectoryStore<string>();
    s.put("a", 100, "id1", "A");
    expect(s.tombstone("a", 200)).toBe(true);
    expect(s.values()).toEqual([]);
  });

  it("suppresses an older snapshot that arrives AFTER the delete (replay order)", () => {
    const s = new DirectoryStore<string>();
    s.tombstone("a", 200);
    expect(s.put("a", 100, "id1", "stale")).toBe(false);
    expect(s.values()).toEqual([]);
  });

  it("suppresses a same-second snapshot (delete wins the tie)", () => {
    const s = new DirectoryStore<string>();
    s.tombstone("a", 200);
    expect(s.put("a", 200, "zzz", "same-second")).toBe(false);
    expect(s.values()).toEqual([]);
  });

  it("evicts a stale snapshot that slipped in before the delete arrived", () => {
    const s = new DirectoryStore<string>();
    s.put("a", 100, "id1", "stale");
    s.tombstone("a", 200);
    expect(s.values()).toEqual([]);
  });

  it("allows re-creation newer than the tombstone", () => {
    const s = new DirectoryStore<string>();
    s.tombstone("a", 200);
    expect(s.put("a", 300, "id2", "resurrected")).toBe(true);
    expect(s.values()).toEqual(["resurrected"]);
  });

  it("keeps the newest tombstone when deletes repeat", () => {
    const s = new DirectoryStore<string>();
    s.tombstone("a", 100);
    s.tombstone("a", 300);
    expect(s.put("a", 200, "id1", "between")).toBe(false);
    expect(s.values()).toEqual([]);
  });

  it("ignores tombstones for unknown d-tags", () => {
    const s = new DirectoryStore<string>();
    expect(s.tombstone("nope", 100)).toBe(false);
  });
});
