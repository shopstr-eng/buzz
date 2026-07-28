import { describe, it, expect } from "vitest";
import {
  catalogToPersonaInput,
  foldCatalogHeads,
  parseCatalogPersona,
  personaEventIsShared,
  type CatalogPersona,
} from "../lib/agent-catalog";
import type { NostrEvent } from "@/shared/lib/relay-connection";

const AUTHOR = "a".repeat(64);

function ev(
  id: string,
  d: string,
  at: number,
  content: Record<string, unknown>,
  tags: string[][] = [["shared", "true"]],
  pubkey = AUTHOR,
): NostrEvent {
  return { id, pubkey, created_at: at, kind: 30175, sig: "s", tags: [["d", d], ...tags], content: JSON.stringify(content) };
}

const BODY = { display_name: "Researcher", system_prompt: "You research." };

describe("personaEventIsShared", () => {
  it("requires exactly one [shared, true] tag", () => {
    expect(personaEventIsShared({ tags: [["shared", "true"]] })).toBe(true);
    expect(personaEventIsShared({ tags: [] })).toBe(false);
    expect(personaEventIsShared({ tags: [["shared", "false"]] })).toBe(false);
    expect(personaEventIsShared({ tags: [["shared", "true"], ["shared", "true"]] })).toBe(false);
    expect(personaEventIsShared({ tags: [["shared", "true", "extra"]] })).toBe(false);
  });
});

describe("parseCatalogPersona", () => {
  it("parses a shared persona with full fields", () => {
    const e = parseCatalogPersona(ev("e1", "d1", 100, {
      ...BODY,
      avatar_url: "https://example.com/a.png",
      runtime: "claude-acp",
      model: "claude-opus-4-5",
      provider: "anthropic",
      name_pool: ["researcher"],
      respond_to: "anyone",
      parallelism: 4,
    }));
    expect(e).toMatchObject({
      coordinate: `${AUTHOR}:d1`,
      displayName: "Researcher",
      avatarUrl: "https://example.com/a.png",
      runtime: "claude-acp",
      respondTo: "anyone",
      parallelism: 4,
    });
  });

  it("rejects unshared events, missing display_name, and multi-d-tag events", () => {
    expect(parseCatalogPersona(ev("e1", "d1", 100, BODY, []))).toBeNull();
    expect(parseCatalogPersona(ev("e1", "d1", 100, { system_prompt: "x" }))).toBeNull();
    const multi = ev("e1", "d1", 100, BODY);
    multi.tags.push(["d", "d2"]);
    expect(parseCatalogPersona(multi)).toBeNull();
  });

  it("accepts inline SVG emoji avatars, rejects base64 data URLs", () => {
    const svg = "data:image/svg+xml,%3Csvg%3E%3C/svg%3E";
    expect(parseCatalogPersona(ev("e1", "d1", 100, { ...BODY, avatar_url: svg }))?.avatarUrl).toBe(svg);
    expect(
      parseCatalogPersona(ev("e1", "d1", 100, { ...BODY, avatar_url: "data:image/png;base64,AAAA" })),
    ).toMatchObject({ avatarUrl: null });
  });

  it("downgrades respond_to allowlist to owner-only and bounds parallelism", () => {
    expect(parseCatalogPersona(ev("e1", "d1", 100, { ...BODY, respond_to: "allowlist" }))?.respondTo).toBe("owner-only");
    expect(parseCatalogPersona(ev("e1", "d1", 100, { ...BODY, parallelism: 99 }))?.parallelism).toBeNull();
    expect(parseCatalogPersona(ev("e1", "d1", 100, { ...BODY, parallelism: 0 }))?.parallelism).toBeNull();
  });
});

describe("foldCatalogHeads", () => {
  it("keeps the latest head per coordinate, ties to the LARGER event id", () => {
    const entries = foldCatalogHeads([
      ev("aaa", "d1", 100, { ...BODY, display_name: "old" }),
      ev("bbb", "d1", 100, { ...BODY, display_name: "tie-winner" }),
      ev("ccc", "d1", 50, { ...BODY, display_name: "oldest" }),
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0].displayName).toBe("tie-winner");
  });

  it("an unshared newest head HIDES an older shared definition", () => {
    const entries = foldCatalogHeads([
      ev("e1", "d1", 100, BODY), // shared
      ev("e2", "d1", 200, BODY, []), // unshared newer head
    ]);
    expect(entries).toHaveLength(0);
  });

  it("sorts newest first and tracks coordinates per author", () => {
    const entries = foldCatalogHeads([
      ev("e1", "d1", 100, { ...BODY, display_name: "one" }),
      ev("e2", "d1", 300, { ...BODY, display_name: "two" }, [["shared", "true"]], "b".repeat(64)),
      ev("e3", "d2", 200, { ...BODY, display_name: "three" }),
    ]);
    expect(entries.map((e) => e.displayName)).toEqual(["two", "three", "one"]);
  });
});

describe("catalogToPersonaInput", () => {
  it("copies land owner-private with owner-only fallback", () => {
    const entry: CatalogPersona = {
      coordinate: `${AUTHOR}:d1`,
      authorPubkey: AUTHOR,
      createdAt: 100,
      displayName: "Researcher",
      avatarUrl: null,
      systemPrompt: "You research.",
      runtime: null,
      model: null,
      provider: null,
      namePool: [],
      respondTo: null,
      parallelism: null,
    };
    const input = catalogToPersonaInput(entry);
    expect(input.shared).toBe(false);
    expect(input.respondTo).toBe("owner-only");
    expect(input.displayName).toBe("Researcher");
    expect(input.avatarUrl).toBeUndefined();
  });
});
