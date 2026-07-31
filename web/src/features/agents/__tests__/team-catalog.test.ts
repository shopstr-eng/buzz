/**
 * Shared team catalog (kind 30178) parsing/folding — mirrors the NIP-AP
 * envelope contract and the persona-catalog head-folding semantics.
 */

import { describe, expect, it } from "vitest";
import {
  catalogTeamMemberToPersonaInput,
  catalogTeamToTeamInput,
  foldTeamCatalogHeads,
  parseCatalogTeam,
  KIND_TEAM_CATALOG,
} from "../lib/team-catalog";
import type { NostrEvent } from "@/shared/lib/relay-connection";

const AUTHOR = "a".repeat(64);

function teamEvent(overrides: Partial<NostrEvent> & { content?: string } = {}): NostrEvent {
  return {
    id: "e1".padEnd(64, "0"),
    pubkey: AUTHOR,
    created_at: 1000,
    kind: KIND_TEAM_CATALOG,
    tags: [
      ["d", "team-uuid-1"],
      ["shared", "true"],
    ],
    content: JSON.stringify({
      v: 1,
      name: "Support Crew",
      description: "Handles inbound questions",
      instructions: "Be nice.",
      members: [
        { display_name: "Helper", system_prompt: "help", respond_to: "anyone" },
        { display_name: "Escalator", system_prompt: "escalate", respond_to: "allowlist" },
      ],
    }),
    sig: "s",
    ...overrides,
  } as NostrEvent;
}

describe("parseCatalogTeam", () => {
  it("parses a shared team head with embedded members", () => {
    const team = parseCatalogTeam(teamEvent());
    expect(team).not.toBeNull();
    expect(team!.coordinate).toBe(`team/${AUTHOR}:team-uuid-1`);
    expect(team!.name).toBe("Support Crew");
    expect(team!.tagline).toBe("Handles inbound questions");
    expect(team!.instructions).toBe("Be nice.");
    expect(team!.members.map((m) => m.displayName)).toEqual(["Helper", "Escalator"]);
  });

  it("downgrades member allowlist respond_to to owner-only (contract rule)", () => {
    const team = parseCatalogTeam(teamEvent());
    expect(team!.members[1].respondTo).toBe("owner-only");
  });

  it("prefers tagline over description when both present", () => {
    const ev = teamEvent({
      content: JSON.stringify({ v: 1, name: "T", tagline: "tag", description: "desc", members: [] }),
    });
    expect(parseCatalogTeam(ev)!.tagline).toBe("tag");
  });

  it("rejects unshared heads and malformed shared tags", () => {
    expect(parseCatalogTeam(teamEvent({ tags: [["d", "x"]] }))).toBeNull();
    expect(
      parseCatalogTeam(teamEvent({ tags: [["d", "x"], ["shared", "true", "extra"]] })),
    ).toBeNull();
    expect(
      parseCatalogTeam(
        teamEvent({ tags: [["d", "x"], ["shared", "true"], ["shared", "true"]] }),
      ),
    ).toBeNull();
  });

  it("rejects missing/empty/duplicate d tags", () => {
    expect(parseCatalogTeam(teamEvent({ tags: [["shared", "true"]] }))).toBeNull();
    expect(parseCatalogTeam(teamEvent({ tags: [["d", ""], ["shared", "true"]] }))).toBeNull();
    expect(
      parseCatalogTeam(teamEvent({ tags: [["d", "a"], ["d", "b"], ["shared", "true"]] })),
    ).toBeNull();
  });

  it("accepts colon-bearing team ids (builtin-team:*) — laxer than persona slugs", () => {
    const ev = teamEvent({ tags: [["d", "builtin-team:welcome"], ["shared", "true"]] });
    expect(parseCatalogTeam(ev)!.coordinate).toBe(`team/${AUTHOR}:builtin-team:welcome`);
  });

  it("drops invalid members individually but keeps the team", () => {
    const ev = teamEvent({
      content: JSON.stringify({
        v: 1,
        name: "T",
        members: [{ display_name: "Ok", system_prompt: "x" }, { nope: true }, "junk"],
      }),
    });
    const team = parseCatalogTeam(ev);
    expect(team!.members).toHaveLength(1);
    expect(team!.members[0].displayName).toBe("Ok");
  });

  it("rejects bodies with a newer schema version, invalid JSON, or blank name", () => {
    expect(
      parseCatalogTeam(teamEvent({ content: JSON.stringify({ v: 2, name: "T", members: [] }) })),
    ).toBeNull();
    expect(parseCatalogTeam(teamEvent({ content: "not json" }))).toBeNull();
    expect(
      parseCatalogTeam(teamEvent({ content: JSON.stringify({ v: 1, name: "  ", members: [] }) })),
    ).toBeNull();
  });
});

describe("foldTeamCatalogHeads", () => {
  it("keeps only the latest head per (author, d); unshared newest hides older shared", () => {
    const shared = teamEvent({ id: "1".padEnd(64, "0"), created_at: 1000 });
    const unsharedNewer = teamEvent({
      id: "2".padEnd(64, "0"),
      created_at: 2000,
      tags: [["d", "team-uuid-1"]],
    });
    expect(foldTeamCatalogHeads([shared, unsharedNewer])).toHaveLength(0);
    expect(foldTeamCatalogHeads([unsharedNewer, shared])).toHaveLength(0);
    expect(foldTeamCatalogHeads([shared])).toHaveLength(1);
  });

  it("breaks same-second ties toward the larger event id", () => {
    const a = teamEvent({ id: "a".padEnd(64, "a"), created_at: 1000 });
    const b = teamEvent({
      id: "f".padEnd(64, "f"),
      created_at: 1000,
      content: JSON.stringify({ v: 1, name: "Winner", members: [] }),
    });
    const folded = foldTeamCatalogHeads([a, b]);
    expect(folded).toHaveLength(1);
    expect(folded[0].name).toBe("Winner");
  });
});

describe("import mapping", () => {
  it("maps members to owner-private persona inputs (shared:false)", () => {
    const team = parseCatalogTeam(teamEvent())!;
    const input = catalogTeamMemberToPersonaInput(team.members[0]);
    expect(input.shared).toBe(false);
    expect(input.displayName).toBe("Helper");
    expect(input.respondTo).toBe("anyone");
  });

  it("maps team fields to the team form input with the minted persona ids", () => {
    const team = parseCatalogTeam(teamEvent())!;
    const input = catalogTeamToTeamInput(team, ["helper", "escalator"]);
    expect(input).toEqual({
      name: "Support Crew",
      description: "Handles inbound questions",
      instructions: "Be nice.",
      personaIds: ["helper", "escalator"],
    });
  });
});
