import { describe, expect, it } from "vitest";
import { parseTeamSnapshot } from "../lib/team-snapshot";
import {
  SNAPSHOT_FORMAT,
  SNAPSHOT_VERSION,
  type AgentSnapshot,
} from "../lib/agent-snapshot";

function member(name: string, overrides?: Partial<AgentSnapshot>): AgentSnapshot {
  return {
    format: SNAPSHOT_FORMAT,
    version: SNAPSHOT_VERSION,
    definition: { name, systemPrompt: `You are ${name}.` },
    profile: { displayName: name },
    memory: { level: "none", entries: [] },
    ...overrides,
  };
}

function team(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    format: "buzz-team-snapshot",
    version: 1,
    team: { name: "Ops Team", description: "handles ops" },
    members: [member("Alice"), member("Bob")],
    ...overrides,
  };
}

describe("parseTeamSnapshot", () => {
  it("accepts a valid two-member team snapshot", () => {
    const result = parseTeamSnapshot(JSON.stringify(team()));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.snapshot.team.name).toBe("Ops Team");
      expect(result.snapshot.members).toHaveLength(2);
      expect(result.snapshot.members[0].profile.displayName).toBe("Alice");
    }
  });

  it("rejects invalid JSON", () => {
    const result = parseTeamSnapshot("{nope");
    expect(result).toMatchObject({ ok: false, error: "File is not valid JSON." });
  });

  it("rejects an agent snapshot (format mismatch)", () => {
    const result = parseTeamSnapshot(JSON.stringify(member("Solo")));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/format mismatch/);
  });

  it("rejects unsupported versions", () => {
    const result = parseTeamSnapshot(JSON.stringify(team({ version: 99 })));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/version/);
  });

  it("rejects an empty team name", () => {
    const result = parseTeamSnapshot(JSON.stringify(team({ team: { name: "   " } })));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/no team name/);
  });

  it("rejects zero members", () => {
    const result = parseTeamSnapshot(JSON.stringify(team({ members: [] })));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/at least one member/);
  });

  it("rejects a member with the wrong format", () => {
    const bad = member("Eve", { format: "not-an-agent" });
    const result = parseTeamSnapshot(JSON.stringify(team({ members: [bad] })));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Team member 1 is invalid/);
  });

  it("rejects a member with memory level 'none' and non-empty entries", () => {
    const bad = member("Eve", {
      memory: { level: "none", entries: [{ slug: "core", body: "leak" }] },
    });
    const result = parseTeamSnapshot(JSON.stringify(team({ members: [member("Alice"), bad] })));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Team member 2 is invalid/);
  });

  it("rejects files over the size limit", () => {
    const huge = JSON.stringify(team({ pad: "x".repeat(5 * 1024 * 1024) }));
    const result = parseTeamSnapshot(huge);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/5 MiB/);
  });
});
