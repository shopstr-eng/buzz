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
  personaToFormInput,
  buildTeamEvent,
  buildTeamCatalogEvent,
  type TeamCatalogMemberSource,
  buildManagedAgentEvent,
  agentToFormInput,
  buildDirectoryDeleteEvent,
  buildTeamCatalogDeleteEvent,
  PERSONA_SLUG_RE,
} from "../agent-events";
import { KIND_PERSONA, KIND_TEAM, KIND_MANAGED_AGENT } from "../use-agents";
import { providerForModel } from "../ui/ModelCombobox";

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

  it("share toggle round-trip is byte-identical except the shared tag", () => {
    // Full desktop-authored persona, incl. contract fields the web UI never edits.
    const full = {
      displayName: "Support Bot",
      systemPrompt: "You help users.",
      avatarUrl: "https://x.test/a.png",
      runtime: "buzz-agent",
      model: "claude-opus-4-5",
      provider: "anthropic",
      respondTo: "allowlist" as const,
      respondToAllowlist: [OWNER],
      parallelism: 3,
      namePool: ["alpha", "beta"],
    };

    for (const [before, after] of [
      [false, true],
      [true, false],
    ] as const) {
      const original = buildPersonaEvent({ ...full, shared: before }, "support-bot", NOW);
      // Stored persona as the directory hook exposes it (nulls for absent).
      const stored = {
        displayName: full.displayName,
        systemPrompt: full.systemPrompt,
        avatarUrl: full.avatarUrl,
        runtime: full.runtime,
        model: full.model,
        provider: full.provider,
        respondTo: full.respondTo,
        respondToAllowlist: full.respondToAllowlist,
        parallelism: full.parallelism,
        namePool: full.namePool,
      };
      const toggled = buildPersonaEvent(personaToFormInput(stored, after), "support-bot", NOW);

      // Byte-identical payload — no desktop-authored field may be dropped.
      expect(toggled.content).toBe(original.content);
      expect(toggled.kind).toBe(original.kind);
      // Tags differ only by the shared marker.
      const strip = (tags: string[][]) => tags.filter((t) => t[0] !== "shared");
      expect(strip(toggled.tags)).toEqual(strip(original.tags));
      expect(toggled.tags.some((t) => t[0] === "shared" && t[1] === "true")).toBe(after);
    }
  });

  it("share toggle round-trip preserves a minimal persona (nulls/empties)", () => {
    const original = buildPersonaEvent(base, "s", NOW);
    const stored = {
      displayName: base.displayName,
      systemPrompt: base.systemPrompt,
      avatarUrl: null,
      runtime: null,
      model: null,
      provider: null,
      respondTo: null, // hook yields null; toggle must default to "anyone"
      respondToAllowlist: [],
      parallelism: null,
      namePool: [],
    };
    const toggled = buildPersonaEvent(personaToFormInput(stored, true), "s", NOW);
    expect(toggled.content).toBe(original.content);
    expect(toggled.tags).toEqual([...original.tags, ["shared", "true"]]);
  });

  it("PersonaDialog edit round-trip preserves desktop-contract fields", () => {
    // Full desktop-authored persona as the directory hook exposes it,
    // including contract fields the edit dialog never shows.
    const stored = {
      displayName: "Support Bot",
      systemPrompt: "You help users.",
      avatarUrl: "https://x.test/a.png",
      runtime: "buzz-agent",
      model: "anthropic:claude-opus-4-5",
      provider: "anthropic",
      respondTo: "allowlist",
      respondToAllowlist: [OWNER],
      parallelism: 3,
      namePool: ["alpha", "beta"],
    };

    for (const shared of [false, true]) {
      const original = buildPersonaEvent(
        personaToFormInput(stored, shared),
        "support-bot",
        NOW,
      );

      // Mirror PersonaDialog: prefill through personaToFormInput, decompose
      // into form state, then rebuild the save input exactly as submit() does.
      const prefill = personaToFormInput(stored, shared);
      const displayName = prefill.displayName;
      const systemPrompt = prefill.systemPrompt;
      const avatarUrl = prefill.avatarUrl ?? "";
      const runtime = prefill.runtime ?? "";
      const model = prefill.model ?? "";
      const provider = prefill.provider ?? "";
      const respondTo = prefill.respondTo;
      const allowlistText = (prefill.respondToAllowlist ?? []).join("\n");
      const respondToAllowlist = allowlistText.split(/[\s,]+/).filter(Boolean);
      const saved = buildPersonaEvent(
        {
          displayName, systemPrompt, avatarUrl, runtime, model,
          provider: providerForModel(model) || provider,
          respondTo, respondToAllowlist,
          parallelism: prefill.parallelism,
          namePool: prefill.namePool,
          shared: prefill.shared,
        },
        "support-bot",
        NOW,
      );

      // Byte-identical payload — desktop-only fields must not be dropped.
      expect(saved.content).toBe(original.content);
      expect(saved.tags).toEqual(original.tags);
      const c = JSON.parse(saved.content);
      expect(c.name_pool).toEqual(["alpha", "beta"]);
      expect(c.parallelism).toBe(3);
      expect(c.respond_to_allowlist).toEqual([OWNER]);
    }
  });

  it("PersonaDialog edit round-trip keeps legacy provider when the model has no prefix", () => {
    const stored = {
      displayName: "Legacy",
      systemPrompt: "p",
      avatarUrl: null,
      runtime: null,
      model: "claude-opus-4-5", // bare legacy id — no provider prefix
      provider: "anthropic",
      respondTo: null,
      respondToAllowlist: [],
      parallelism: null,
      namePool: [],
    };
    const prefill = personaToFormInput(stored, false);
    const model = prefill.model ?? "";
    const saved = buildPersonaEvent(
      { ...prefill, provider: providerForModel(model) || (prefill.provider ?? "") },
      "legacy",
      NOW,
    );
    const c = JSON.parse(saved.content);
    expect(c.provider).toBe("anthropic");
    expect(c.respond_to).toBe("anyone");
  });

  it("pins exact serialized key order to the desktop struct (byte-compared by desktop)", () => {
    // Desktop PersonaEventContent order: display_name, system_prompt,
    // avatar_url, runtime, model, provider, name_pool, respond_to,
    // respond_to_allowlist, parallelism.
    const ev = buildPersonaEvent(
      {
        displayName: "Support Bot",
        systemPrompt: "You help users.",
        avatarUrl: "https://x.test/a.png",
        runtime: "buzz-agent",
        model: "claude-opus-4-5",
        provider: "anthropic",
        namePool: ["alpha", "beta"],
        respondTo: "allowlist",
        respondToAllowlist: [OWNER],
        parallelism: 3,
        shared: false,
      },
      "support-bot",
      NOW,
    );
    expect(ev.content).toBe(
      `{"display_name":"Support Bot","system_prompt":"You help users.","avatar_url":"https://x.test/a.png","runtime":"buzz-agent","model":"claude-opus-4-5","provider":"anthropic","name_pool":["alpha","beta"],"respond_to":"allowlist","respond_to_allowlist":["${OWNER}"],"parallelism":3}`,
    );
  });

  it("preserves name_pool verbatim (desktop contract field)", () => {
    const withPool = JSON.parse(
      buildPersonaEvent({ ...base, namePool: ["alpha", "beta"] }, "s", NOW).content,
    );
    expect(withPool.name_pool).toEqual(["alpha", "beta"]);
    const without = JSON.parse(buildPersonaEvent(base, "s", NOW).content);
    expect(without).not.toHaveProperty("name_pool");
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

describe("buildTeamCatalogEvent", () => {
  const member: TeamCatalogMemberSource = {
    displayName: "Helper",
    systemPrompt: "You help.",
    avatarUrl: "https://example.com/a.png",
    runtime: "goose",
    model: "claude-opus-4",
    provider: "anthropic",
    namePool: ["Alpha", "Beta"],
    respondTo: "anyone",
    parallelism: 4,
  };
  const team = { name: "Support Crew", description: "Handles inbound", instructions: "Be nice." };

  it("emits the v1 envelope: d = team id, exact shared tag, versioned body", () => {
    const ev = buildTeamCatalogEvent(team, [member], "team-uuid-1", true, NOW);
    expect(ev.kind).toBe(30178);
    expect(ev.created_at).toBe(NOW);
    expect(ev.tags).toEqual([["d", "team-uuid-1"], ["shared", "true"]]);
    const c = JSON.parse(ev.content);
    expect(c.v).toBe(1);
    expect(c.name).toBe("Support Crew");
    expect(c.description).toBe("Handles inbound");
    expect(c.instructions).toBe("Be nice.");
    expect(c.members).toHaveLength(1);
    expect(c.members[0]).toEqual({
      display_name: "Helper",
      system_prompt: "You help.",
      avatar_url: "https://example.com/a.png",
      runtime: "goose",
      model: "claude-opus-4",
      provider: "anthropic",
      name_pool: ["Alpha", "Beta"],
      respond_to: "anyone",
      parallelism: 4,
    });
  });

  it("unsharing republishes without the shared tag", () => {
    const ev = buildTeamCatalogEvent(team, [member], "team-uuid-1", false, NOW);
    expect(ev.tags).toEqual([["d", "team-uuid-1"]]);
  });

  it("omits optional team fields when empty and keeps builtin-team ids verbatim", () => {
    const ev = buildTeamCatalogEvent({ name: "Bare" }, [], "builtin-team:welcome", true, NOW);
    expect(ev.tags[0]).toEqual(["d", "builtin-team:welcome"]);
    const c = JSON.parse(ev.content);
    expect(c).not.toHaveProperty("description");
    expect(c).not.toHaveProperty("instructions");
    expect(c.members).toEqual([]);
  });

  it("sanitizes members: allowlist downgrades to owner-only and never leaks the allowlist", () => {
    const ev = buildTeamCatalogEvent(
      team,
      [{ ...member, respondTo: "allowlist", namePool: [], parallelism: 1, avatarUrl: null, runtime: null, model: null, provider: null }],
      "t",
      true,
      NOW,
    );
    const m = JSON.parse(ev.content).members[0];
    expect(m).toEqual({ display_name: "Helper", system_prompt: "You help.", respond_to: "owner-only" });
    expect(JSON.stringify(m)).not.toContain("allowlist");
  });

  it("round-trips through the catalog parser (share → foreign read)", async () => {
    const { parseCatalogTeam } = await import("../lib/team-catalog");
    const ev = buildTeamCatalogEvent(team, [member], "team-uuid-1", true, NOW);
    const parsed = parseCatalogTeam({
      ...ev,
      id: "e".repeat(64),
      pubkey: OWNER,
      sig: "s",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    expect(parsed).not.toBeNull();
    expect(parsed!.name).toBe("Support Crew");
    expect(parsed!.tagline).toBe("Handles inbound");
    expect(parsed!.instructions).toBe("Be nice.");
    expect(parsed!.members.map((m) => m.displayName)).toEqual(["Helper"]);
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

  it("ManagedAgentDialog edit round-trip preserves all contract fields", () => {
    const pk = "b".repeat(64);
    const variants = [
      // Persona-linked: runtime config resolves through the persona.
      {
        name: "Nightly runner",
        personaId: "support-bot",
        systemPrompt: null,
        model: null,
        provider: null,
        respondTo: "allowlist",
        respondToAllowlist: ["c".repeat(64), "d".repeat(64)],
        parallelism: 3,
        personaSourceVersion: null,
      },
      // Standalone: inline runtime fields carried in the record.
      {
        name: "Solo agent",
        personaId: null,
        systemPrompt: "You run nightly jobs.",
        model: "openai/gpt-5",
        provider: "openai",
        respondTo: "anyone",
        respondToAllowlist: [],
        parallelism: 2,
        // Desktop drift indicator — must survive a web edit verbatim.
        personaSourceVersion: "abc123",
      },
    ];

    for (const stored of variants) {
      const original = buildManagedAgentEvent(agentToFormInput(stored), pk, NOW);

      // Mirror ManagedAgentDialog: prefill through agentToFormInput, decompose
      // into form state, then rebuild the save input exactly as submit() does.
      const prefill = agentToFormInput(stored);
      const name = prefill.name;
      const personaId = prefill.personaId ?? "";
      const systemPrompt = prefill.systemPrompt ?? "";
      const model = prefill.model ?? "";
      const respondTo = prefill.respondTo;
      const allowlistText = (prefill.respondToAllowlist ?? []).join("\n");
      const parallelism = prefill.parallelism;

      const saved = buildManagedAgentEvent(
        {
          name,
          personaId: personaId || undefined,
          systemPrompt: systemPrompt || undefined,
          model: model || undefined,
          provider: providerForModel(model) || prefill.provider || undefined,
          personaSourceVersion: prefill.personaSourceVersion,
          respondTo,
          respondToAllowlist: allowlistText.split(/[\s,]+/).filter(Boolean),
          parallelism: Math.max(1, Math.floor(parallelism) || 1),
        },
        pk,
        NOW,
      );

      // Byte-identical payload — no field may be dropped or reset by an edit.
      expect(saved.content).toBe(original.content);
      expect(saved.kind).toBe(original.kind);
      expect(saved.tags).toEqual(original.tags);
    }
  });

  it("pins exact serialized key order to the desktop struct (byte-compared by desktop)", () => {
    // Desktop suppresses republishes by comparing raw content bytes against
    // its own serde serialization of ManagedAgentEventContent, so key order
    // is part of the contract: name, persona_id, system_prompt, model,
    // provider, persona_source_version, parallelism, respond_to,
    // respond_to_allowlist.
    const standalone = buildManagedAgentEvent(
      {
        name: "Solo",
        systemPrompt: "You run.",
        model: "m",
        provider: "p",
        personaSourceVersion: "abc123",
        respondTo: "allowlist",
        respondToAllowlist: ["c".repeat(64)],
        parallelism: 2,
      },
      "b".repeat(64),
      NOW,
    );
    expect(standalone.content).toBe(
      `{"name":"Solo","system_prompt":"You run.","model":"m","provider":"p","persona_source_version":"abc123","parallelism":2,"respond_to":"allowlist","respond_to_allowlist":["${"c".repeat(64)}"]}`,
    );

    const linked = buildManagedAgentEvent(
      { name: "Linked", personaId: "support-bot", respondTo: "owner-only", parallelism: 1 },
      "b".repeat(64),
      NOW,
    );
    expect(linked.content).toBe(
      '{"name":"Linked","persona_id":"support-bot","parallelism":1,"respond_to":"owner-only"}',
    );
  });

  it("edit round-trip keeps a stored provider the model prefix can't re-derive", () => {
    const stored = {
      name: "Legacy",
      personaId: null,
      systemPrompt: "s",
      model: "custom-model-no-prefix",
      provider: "legacy-provider",
      respondTo: "owner-only",
      respondToAllowlist: [],
      parallelism: 1,
      personaSourceVersion: null,
    };
    const prefill = agentToFormInput(stored);
    const model = prefill.model ?? "";
    const saved = buildManagedAgentEvent(
      { ...prefill, provider: providerForModel(model) || prefill.provider || undefined },
      "b".repeat(64),
      NOW,
    );
    expect(JSON.parse(saved.content).provider).toBe("legacy-provider");
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

describe("buildTeamCatalogDeleteEvent", () => {
  it("emits kind 5 with the 30178 address a-tag and k tag (NIP-AP)", () => {
    const ev = buildTeamCatalogDeleteEvent(OWNER, "team-uuid", NOW);
    expect(ev.kind).toBe(5);
    expect(ev.created_at).toBe(NOW);
    expect(ev.tags).toEqual([
      ["a", `30178:${OWNER}:team-uuid`],
      ["k", "30178"],
    ]);
    expect(ev.content).toBe("");
  });
});
