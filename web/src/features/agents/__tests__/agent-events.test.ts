/**
 * Contract tests for the web's agent-directory event builders. These pin the
 * wire format to the desktop write contract (persona_events.rs,
 * team_events.rs, agent_events.rs) so web- and desktop-published records stay
 * interchangeable.
 */

import { describe, it, expect } from "vitest";
import {
  slugifyPersonaName,
  ensureUniqueSlug,
  buildPersonaEvent,
  buildTeamEvent,
  buildManagedAgentEvent,
  buildDirectoryDeleteEvent,
  PERSONA_SLUG_RE,
} from "../agent-events";
import { KIND_PERSONA, KIND_TEAM, KIND_MANAGED_AGENT } from "../use-agents";

const NOW = 1_800_000_000;
const OWNER = "a".repeat(64);

describe("slugifyPersonaName", () => {
  it("normalizes display names to the desktop slug grammar", () => {
    expect(slugifyPersonaName("Support Bot")).toBe("support-bot");
    expect(slugifyPersonaName("  My  Agent!! ")).toBe("my-agent");
    expect(slugifyPersonaName("Agent_42")).toBe("agent_42");
  });

  it("falls back when nothing usable remains", () => {
    expect(slugifyPersonaName("!!!")).toBe("persona");
    expect(slugifyPersonaName("")).toBe("persona");
  });

  it("caps at 64 chars and never emits trailing separators", () => {
    const slug = slugifyPersonaName(`x${"a".repeat(100)}-`);
    expect(slug.length).toBeLessThanOrEqual(64);
    expect(PERSONA_SLUG_RE.test(slug)).toBe(true);
  });
});

describe("ensureUniqueSlug", () => {
  it("keeps the base slug when free", () => {
    expect(ensureUniqueSlug("support-bot", ["other"])).toBe("support-bot");
  });

  it("suffixes until unique and stays within the grammar", () => {
    expect(ensureUniqueSlug("bot", ["bot"])).toBe("bot-2");
    expect(ensureUniqueSlug("bot", ["bot", "bot-2"])).toBe("bot-3");
    const long = "a".repeat(64);
    const candidate = ensureUniqueSlug(long, [long]);
    expect(PERSONA_SLUG_RE.test(candidate)).toBe(true);
    expect(candidate.length).toBeLessThanOrEqual(64);
  });
});

describe("buildPersonaEvent", () => {
  const base = {
    displayName: "Support Bot",
    systemPrompt: "You help users.",
    respondTo: "anyone" as const,
    shared: false,
  };

  it("emits the desktop content shape with d tag", () => {
    const ev = buildPersonaEvent(base, "support-bot", NOW);
    expect(ev.kind).toBe(KIND_PERSONA);
    expect(ev.created_at).toBe(NOW);
    expect(ev.tags).toEqual([["d", "support-bot"]]);
    const c = JSON.parse(ev.content);
    expect(c.display_name).toBe("Support Bot");
    expect(c.system_prompt).toBe("You help users.");
    expect(c.respond_to).toBe("anyone");
    expect(c).not.toHaveProperty("avatar_url");
    expect(c).not.toHaveProperty("parallelism");
    expect(c).not.toHaveProperty("respond_to_allowlist");
  });

  it("adds the shared tag only when requested", () => {
    expect(buildPersonaEvent({ ...base, shared: true }, "s", NOW).tags).toContainEqual(["shared", "true"]);
    expect(buildPersonaEvent(base, "s", NOW).tags).not.toContainEqual(["shared", "true"]);
  });

  it("includes optional fields only when set", () => {
    const ev = buildPersonaEvent(
      {
        ...base,
        avatarUrl: "https://x.test/a.png",
        runtime: "buzz-agent",
        model: "claude-opus-4-5",
        provider: "anthropic",
        respondTo: "allowlist",
        respondToAllowlist: [OWNER],
        parallelism: 3,
      },
      "s",
      NOW,
    );
    const c = JSON.parse(ev.content);
    expect(c.avatar_url).toBe("https://x.test/a.png");
    expect(c.runtime).toBe("buzz-agent");
    expect(c.model).toBe("claude-opus-4-5");
    expect(c.provider).toBe("anthropic");
    expect(c.respond_to_allowlist).toEqual([OWNER]);
    expect(c.parallelism).toBe(3);
  });

  it("omits parallelism of 1 (desktop default)", () => {
    const c = JSON.parse(buildPersonaEvent({ ...base, parallelism: 1 }, "s", NOW).content);
    expect(c).not.toHaveProperty("parallelism");
  });
});

describe("buildTeamEvent", () => {
  it("emits the desktop content shape with explicit-null instructions", () => {
    const ev = buildTeamEvent({ name: "Ops", personaIds: ["p1", "p2"] }, "team-1", NOW);
    expect(ev.kind).toBe(KIND_TEAM);
    expect(ev.tags).toEqual([["d", "team-1"]]);
    const c = JSON.parse(ev.content);
    expect(c.name).toBe("Ops");
    expect(c.instructions).toBeNull();
    expect(c.persona_ids).toEqual(["p1", "p2"]);
    expect(c).not.toHaveProperty("description");
  });

  it("keeps instructions when provided", () => {
    const c = JSON.parse(
      buildTeamEvent(
        { name: "Ops", description: "d", instructions: "Be brief.", personaIds: [] },
        "t",
        NOW,
      ).content,
    );
    expect(c.instructions).toBe("Be brief.");
    expect(c.description).toBe("d");
  });
});

describe("buildManagedAgentEvent", () => {
  const base = { name: "Runner", respondTo: "owner-only" as const, parallelism: 1 };

  it("d-tags on the agent's own pubkey", () => {
    const pk = "b".repeat(64);
    const ev = buildManagedAgentEvent(base, pk, NOW);
    expect(ev.kind).toBe(KIND_MANAGED_AGENT);
    expect(ev.tags).toEqual([["d", pk]]);
    const c = JSON.parse(ev.content);
    expect(c.name).toBe("Runner");
    expect(c.parallelism).toBe(1);
    expect(c.respond_to).toBe("owner-only");
  });

  it("slims inline runtime fields when linked to a persona", () => {
    const c = JSON.parse(
      buildManagedAgentEvent(
        { ...base, personaId: "support-bot", systemPrompt: "ignored", model: "ignored" },
        "b".repeat(64),
        NOW,
      ).content,
    );
    expect(c.persona_id).toBe("support-bot");
    expect(c).not.toHaveProperty("system_prompt");
    expect(c).not.toHaveProperty("model");
    expect(c).not.toHaveProperty("provider");
    expect(c).not.toHaveProperty("persona_source_version");
  });

  it("keeps inline runtime fields when standalone", () => {
    const c = JSON.parse(
      buildManagedAgentEvent({ ...base, systemPrompt: "You run.", model: "m", provider: "p" }, "b".repeat(64), NOW)
        .content,
    );
    expect(c.system_prompt).toBe("You run.");
    expect(c.model).toBe("m");
    expect(c.provider).toBe("p");
    expect(c).not.toHaveProperty("persona_id");
  });
});

describe("buildDirectoryDeleteEvent", () => {
  it("emits kind 5 with only the address a-tag (desktop contract)", () => {
    const ev = buildDirectoryDeleteEvent(KIND_PERSONA, OWNER, "support-bot", NOW);
    expect(ev.kind).toBe(5);
    expect(ev.tags).toEqual([["a", `${KIND_PERSONA}:${OWNER}:support-bot`]]);
    expect(ev.content).toBe("");
  });

  it("addresses each directory kind", () => {
    expect(buildDirectoryDeleteEvent(KIND_TEAM, OWNER, "t", NOW).tags[0][1]).toBe(`${KIND_TEAM}:${OWNER}:t`);
    expect(buildDirectoryDeleteEvent(KIND_MANAGED_AGENT, OWNER, "m", NOW).tags[0][1]).toBe(
      `${KIND_MANAGED_AGENT}:${OWNER}:m`,
    );
  });
});
