import { describe, it, expect } from "vitest";
import {
  EngramStore,
  buildMemoryGraph,
  extractRefs,
  parseEngramBody,
  type EngramEntry,
} from "../lib/engrams";

const AGENT = "a".repeat(64);

function ev(id: string, d: string, at: number, pubkey = AGENT) {
  return { id, pubkey, created_at: at, tags: [["d", d], ["p", "o".repeat(64)]] };
}

function entry(slug: string, text: string | null, agent = AGENT): EngramEntry {
  return {
    id: `id-${slug}`,
    agentPubkey: agent,
    dTag: `d-${slug}`,
    createdAt: 100,
    body: slug === "core"
      ? { slug, value: null, profile: text }
      : { slug, value: text, profile: null },
  };
}

describe("parseEngramBody", () => {
  it("parses memory / core / tombstone bodies", () => {
    expect(parseEngramBody('{"slug":"mem/x","value":"hello"}')).toEqual({
      slug: "mem/x", value: "hello", profile: null,
    });
    expect(parseEngramBody('{"slug":"core","profile":"I am an agent"}')).toEqual({
      slug: "core", value: null, profile: "I am an agent",
    });
    expect(parseEngramBody('{"slug":"mem/x","value":null}')).toEqual({
      slug: "mem/x", value: null, profile: null,
    });
  });

  it("rejects malformed bodies", () => {
    expect(parseEngramBody("not json")).toBeNull();
    expect(parseEngramBody('{"value":"x"}')).toBeNull();
    expect(parseEngramBody('{"slug":"core"}')).toBeNull();
    expect(parseEngramBody('{"slug":"mem/x"}')).toBeNull();
  });
});

describe("extractRefs", () => {
  it("extracts wiki-links deduped in order", () => {
    expect(extractRefs("see [[mem/a]] and [[mem/b]], again [[mem/a]]")).toEqual(["mem/a", "mem/b"]);
  });

  it("ignores empties and non-links", () => {
    expect(extractRefs("no links here [single]")).toEqual([]);
  });
});

describe("EngramStore", () => {
  it("latest created_at wins per (agent, d)", () => {
    const s = new EngramStore();
    const body = { slug: "mem/x", value: "old", profile: null };
    s.apply(ev("e1", "d1", 100), body);
    expect(s.apply(ev("e2", "d1", 200), { ...body, value: "new" })).toBe(true);
    expect(s.apply(ev("e3", "d1", 50), { ...body, value: "oldest" })).toBe(false);
    expect(s.entries()[0].body.value).toBe("new");
  });

  it("breaks same-second ties by LOWEST event id", () => {
    const s = new EngramStore();
    const body = { slug: "mem/x", value: "v", profile: null };
    s.apply(ev("mmm", "d1", 100), body);
    expect(s.apply(ev("zzz", "d1", 100), body)).toBe(false);
    expect(s.apply(ev("aaa", "d1", 100), body)).toBe(true);
    expect(s.entries()[0].id).toBe("aaa");
  });

  it("tracks heads independently per agent", () => {
    const s = new EngramStore();
    const body = { slug: "mem/x", value: "v", profile: null };
    s.apply(ev("e1", "d1", 100), body);
    s.apply(ev("e2", "d1", 100, "b".repeat(64)), body);
    expect(s.entries()).toHaveLength(2);
  });
});

describe("buildMemoryGraph", () => {
  it("classifies reachable / orphan / dangling from the core root", () => {
    const g = buildMemoryGraph([
      entry("core", "I remember [[mem/a]]"),
      entry("mem/a", "links to [[mem/b]] and [[mem/gone]]"),
      entry("mem/b", "leaf"),
      entry("mem/orphan", "unreferenced"),
    ]);
    expect([...g.reachable.keys()].sort()).toEqual(["core", "mem/a", "mem/b"]);
    expect(g.orphans.map((n) => n.slug)).toEqual(["mem/orphan"]);
    expect(g.danglingRefs).toEqual(["mem/gone"]);
  });

  it("excludes tombstoned slugs and surfaces refs to them as dangling", () => {
    const g = buildMemoryGraph([
      entry("core", "see [[mem/dead]]"),
      entry("mem/dead", null), // tombstone
    ]);
    expect(g.reachable.has("mem/dead")).toBe(false);
    expect(g.danglingRefs).toEqual(["mem/dead"]);
  });

  it("survives reference cycles", () => {
    const g = buildMemoryGraph([
      entry("core", "[[mem/a]]"),
      entry("mem/a", "[[mem/b]]"),
      entry("mem/b", "[[mem/a]]"),
    ]);
    expect([...g.reachable.keys()].sort()).toEqual(["core", "mem/a", "mem/b"]);
  });

  it("everything is an orphan when there is no core", () => {
    const g = buildMemoryGraph([entry("mem/a", "[[mem/b]]"), entry("mem/b", "leaf")]);
    expect(g.core).toBeNull();
    expect(g.orphans).toHaveLength(2);
  });
});
