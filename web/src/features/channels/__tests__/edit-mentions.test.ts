import { describe, it, expect } from "vitest";
import { extractMentionPubkeys, diffAddedMentionPubkeys } from "../lib/edit-mentions";

const ALICE = "a".repeat(64);
const BOB = "b".repeat(64);
const SELF = "c".repeat(64);

const MAP = new Map([
  ["alice a.", ALICE],
  ["bob", BOB],
]);

describe("extractMentionPubkeys", () => {
  it("resolves @name tokens case-insensitively", () => {
    expect([...extractMentionPubkeys("hey @Bob look", MAP)]).toEqual([BOB]);
  });

  it("matches the longest name first (names with spaces)", () => {
    expect([...extractMentionPubkeys("cc @Alice A. done", MAP)]).toEqual([ALICE]);
  });

  it("ignores unknown names and mid-token @", () => {
    expect(extractMentionPubkeys("email bob@alice.com @nobody", MAP).size).toBe(0);
  });

  it("requires a word boundary after the name", () => {
    expect(extractMentionPubkeys("@bobby", MAP).size).toBe(0);
    expect([...extractMentionPubkeys("@bob!", MAP)]).toEqual([BOB]);
  });

  it("returns empty for content without @", () => {
    expect(extractMentionPubkeys("plain text", MAP).size).toBe(0);
  });
});

describe("diffAddedMentionPubkeys", () => {
  it("keeps only mentions absent from the original", () => {
    const original = new Set([ALICE]);
    const final = new Set([ALICE, BOB]);
    expect(diffAddedMentionPubkeys(original, final)).toEqual([BOB]);
  });

  it("excludes the editor's own pubkey", () => {
    expect(diffAddedMentionPubkeys(new Set(), new Set([SELF, BOB]), SELF)).toEqual([BOB]);
  });

  it("returns empty when nothing was added (typo fix)", () => {
    const original = new Set([ALICE, BOB]);
    expect(diffAddedMentionPubkeys(original, new Set([ALICE]))).toEqual([]);
  });
});
