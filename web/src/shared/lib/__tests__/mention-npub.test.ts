/**
 * Mixed-case nostr:npub mention handling (review finding): content tokens may
 * arrive uppercase/mixed-case, but mentionNames is keyed by lowercase
 * nip19.npubEncode output — decode and lookup must canonicalize case.
 */

import { describe, expect, it } from "vitest";
import { nip19 } from "nostr-tools";
import {
  NPUB_MENTION_RE,
  canonicalNpubKey,
  pubkeyFromNpubToken,
} from "../mention-npub";

const HEX = "a".repeat(64);
const NPUB = nip19.npubEncode(HEX);

describe("pubkeyFromNpubToken", () => {
  it("decodes lowercase npub", () => {
    expect(pubkeyFromNpubToken(NPUB)).toBe(HEX);
  });

  it("decodes uppercase npub to the same pubkey", () => {
    expect(pubkeyFromNpubToken(NPUB.toUpperCase())).toBe(HEX);
  });

  it("returns null for garbage", () => {
    expect(pubkeyFromNpubToken("npub1notreal")).toBeNull();
  });
});

describe("canonicalNpubKey", () => {
  it("uppercase token canonicalizes to the npubEncode map key", () => {
    // mentionNames is keyed by nip19.npubEncode(pubkey) (lowercase); a mixed/
    // uppercase content token must hit the same key.
    expect(canonicalNpubKey(NPUB.toUpperCase())).toBe(NPUB);
    expect(canonicalNpubKey(NPUB)).toBe(NPUB);
  });
});

describe("NPUB_MENTION_RE", () => {
  it("matches mixed-case nostr:NPUB tokens in content", () => {
    const content = `ping nostr:${NPUB.toUpperCase()} hi`;
    const matches = [...content.matchAll(NPUB_MENTION_RE)];
    expect(matches).toHaveLength(1);
    expect(pubkeyFromNpubToken(matches[0][1])).toBe(HEX);
  });

  it("finds multiple mentions", () => {
    const other = nip19.npubEncode("b".repeat(64));
    const content = `nostr:${NPUB} and nostr:${other}`;
    expect([...content.matchAll(NPUB_MENTION_RE)]).toHaveLength(2);
  });
});
