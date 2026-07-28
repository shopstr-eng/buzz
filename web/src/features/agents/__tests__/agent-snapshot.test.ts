import { describe, it, expect } from "vitest";
import {
  buildSnapshot,
  parseSnapshot,
  snapshotToPersonaInput,
  SNAPSHOT_FORMAT,
  SNAPSHOT_VERSION,
  MAX_SNAPSHOT_JSON_BYTES,
  type AgentSnapshot,
} from "../lib/agent-snapshot";
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
    });
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
