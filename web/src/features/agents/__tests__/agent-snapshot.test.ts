import { describe, it, expect } from "vitest";
import {
  buildSnapshot,
  parseSnapshot,
  snapshotToPersonaInput,
  SNAPSHOT_FORMAT,
  SNAPSHOT_VERSION,
  MAX_SNAPSHOT_JSON_BYTES,
  selectMemoryEntries,
  type AgentSnapshot,
} from "../lib/agent-snapshot";
import { buildMemoryGraph, type EngramEntry } from "../lib/engrams";
import type { AgentPersona } from "../use-agents";

const PERSONA: AgentPersona = {
  id: "researcher",
  displayName: "Researcher",
  avatarUrl: "https://example.com/avatar.png",
  systemPrompt: "You research things.",
  runtime: "claude-acp",
  model: "claude-opus-4-5",
  provider: "anthropic",
  isBuiltIn: false,
  respondTo: "allowlist",
  shared: true,
  namePool: ["researcher", "scout"],
  parallelism: 3,
  respondToAllowlist: ["a".repeat(64)],
};

describe("buildSnapshot", () => {
  it("produces the desktop shape with all configured fields", () => {
    const s = buildSnapshot(PERSONA);
    expect(s.format).toBe(SNAPSHOT_FORMAT);
    expect(s.version).toBe(SNAPSHOT_VERSION);
    expect(s.definition).toEqual({
      name: "Researcher",
      systemPrompt: "You research things.",
      sourceIsBuiltin: false,
      runtime: "claude-acp",
      model: "claude-opus-4-5",
      provider: "anthropic",
      parallelism: 3,
      respondTo: "allowlist",
      respondToAllowlist: ["a".repeat(64)],
      namePool: ["researcher", "scout"],
    });
    expect(s.profile).toEqual({
      displayName: "Researcher",
      avatarUrl: "https://example.com/avatar.png",
    });
    expect(s.memory).toEqual({ level: "none", entries: [] });
  });

  it("embeds small data-URL avatars inline, references large/remote ones", () => {
    const small = { ...PERSONA, avatarUrl: "data:image/png;base64,AAAA" };
    expect(buildSnapshot(small).profile.avatarDataUrl).toBe("data:image/png;base64,AAAA");
    expect(buildSnapshot(small).profile.avatarUrl).toBeUndefined();
    const big = { ...PERSONA, avatarUrl: `data:image/png;base64,${"A".repeat(3 * 1024 * 1024)}` };
    expect(buildSnapshot(big).profile.avatarDataUrl).toBeUndefined();
    expect(buildSnapshot(big).profile.avatarUrl).toBe(big.avatarUrl);
  });

  it("omits unconfigured optional fields", () => {
    const bare: AgentPersona = {
      ...PERSONA,
      avatarUrl: null,
      runtime: null,
      model: null,
      provider: null,
      respondTo: null,
      namePool: [],
      parallelism: null,
      respondToAllowlist: [],
    };
    expect(buildSnapshot(bare).definition).toEqual({
      name: "Researcher",
      systemPrompt: "You research things.",
      sourceIsBuiltin: false,
    });
  });
});

function engram(slug: string, text: string): EngramEntry {
  return {
    id: "e".repeat(64),
    agentPubkey: "a".repeat(64),
    dTag: slug,
    createdAt: 1,
    body:
      slug === "core"
        ? { slug, value: null, profile: text }
        : { slug, value: text, profile: null },
  };
}

describe("memory-bearing snapshots (desktop share-dialog parity)", () => {
  const graph = buildMemoryGraph([
    engram("core", "Core profile. See [[mem/linked]]."),
    engram("mem/linked", "Reachable from core."),
    engram("mem/orphan", "Not linked from core."),
  ]);

  it("selectMemoryEntries: core level bundles only the core entry", () => {
    expect(selectMemoryEntries(graph, "core")).toEqual([
      { slug: "core", body: "Core profile. See [[mem/linked]]." },
    ]);
  });

  it("selectMemoryEntries: everything bundles core first, then ALL live entries (orphans included) sorted by slug", () => {
    expect(selectMemoryEntries(graph, "everything").map((e) => e.slug)).toEqual([
      "core",
      "mem/linked",
      "mem/orphan",
    ]);
  });

  it("selectMemoryEntries: none is always empty", () => {
    expect(selectMemoryEntries(graph, "none")).toEqual([]);
  });

  it("buildSnapshot embeds the entries at the requested level and round-trips through parseSnapshot", () => {
    const entries = selectMemoryEntries(graph, "everything");
    const s = buildSnapshot(PERSONA, { level: "everything", entries });
    expect(s.memory).toEqual({ level: "everything", entries });
    expect(parseSnapshot(JSON.stringify(s)).ok).toBe(true);
  });

  it("buildSnapshot normalizes level 'none' to empty entries (desktop write invariant)", () => {
    const s = buildSnapshot(PERSONA, {
      level: "none",
      entries: [{ slug: "core", body: "should be dropped" }],
    });
    expect(s.memory).toEqual({ level: "none", entries: [] });
  });
});

describe("parseSnapshot", () => {
  const valid = JSON.stringify(buildSnapshot(PERSONA));

  it("round-trips a built snapshot", () => {
    const r = parseSnapshot(valid);
    expect(r.ok).toBe(true);
  });

  it("rejects oversize files", () => {
    const big = `{"format":"${SNAPSHOT_FORMAT}","pad":"${"x".repeat(MAX_SNAPSHOT_JSON_BYTES)}"}`;
    const r = parseSnapshot(big);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/5 MiB/);
  });

  it("rejects format / version mismatches", () => {
    expect(parseSnapshot('{"format":"other","version":1}').ok).toBe(false);
    expect(parseSnapshot(JSON.stringify({ ...JSON.parse(valid), version: 2 })).ok).toBe(false);
  });

  it("rejects empty definition name / profile displayName", () => {
    const base = JSON.parse(valid) as AgentSnapshot;
    expect(parseSnapshot(JSON.stringify({ ...base, definition: { ...base.definition, name: " " } })).ok).toBe(false);
    expect(parseSnapshot(JSON.stringify({ ...base, profile: { displayName: "" } })).ok).toBe(false);
  });

  it("rejects memory level 'none' with entries and unknown levels", () => {
    const base = JSON.parse(valid) as AgentSnapshot;
    const withEntries = { ...base, memory: { level: "none", entries: [{ x: 1 }] } };
    expect(parseSnapshot(JSON.stringify(withEntries)).ok).toBe(false);
    const badLevel = { ...base, memory: { level: "some", entries: [] } };
    expect(parseSnapshot(JSON.stringify(badLevel)).ok).toBe(false);
  });

  it("accepts core/everything memory with entries (ignored by web import)", () => {
    const base = JSON.parse(valid) as AgentSnapshot;
    const core = { ...base, memory: { level: "core", entries: [{ k: "v" }] } };
    expect(parseSnapshot(JSON.stringify(core)).ok).toBe(true);
  });
});

describe("snapshotToPersonaInput", () => {
  it("maps fields and defaults respondTo to owner-only on unknown values", () => {
    const s = buildSnapshot(PERSONA);
    const input = snapshotToPersonaInput(s);
    expect(input.displayName).toBe("Researcher");
    expect(input.respondTo).toBe("allowlist");
    expect(input.shared).toBe(false);
    const weird = { ...s, definition: { ...s.definition, respondTo: "everybody" } };
    expect(snapshotToPersonaInput(weird).respondTo).toBe("owner-only");
  });

  it("prefers avatarDataUrl over avatarUrl", () => {
    const s = buildSnapshot(PERSONA);
    const withData: AgentSnapshot = {
      ...s,
      profile: { ...s.profile, avatarDataUrl: "data:image/png;base64,AAAA" },
    };
    expect(snapshotToPersonaInput(withData).avatarUrl).toBe("data:image/png;base64,AAAA");
  });
});

describe("sourceIsBuiltin (upstream #2439)", () => {
  it("export marks web personas as non-built-in (desktop persona exports hardcode false)", () => {
    expect(buildSnapshot(PERSONA).definition.sourceIsBuiltin).toBe(false);
  });

  it("parses desktop exports carrying sourceIsBuiltin; import never grants built-in status", () => {
    const s = buildSnapshot(PERSONA);
    const fromDesktop = {
      ...s,
      definition: { ...s.definition, sourceIsBuiltin: true },
    };
    const parsed = parseSnapshot(JSON.stringify(fromDesktop));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      // Round-trip metadata survives parse…
      expect(parsed.snapshot.definition.sourceIsBuiltin).toBe(true);
      // …but the import input has no built-in concept: always-mint, owner-private.
      const input = snapshotToPersonaInput(parsed.snapshot);
      expect(input.shared).toBe(false);
      expect("sourceIsBuiltin" in input).toBe(false);
    }
  });
});
