/**
 * Stale-share detection for kind:30178 team-catalog snapshots — the
 * published head content vs. what would be projected NOW from the current
 * team + member personas.
 */

import { describe, expect, it } from "vitest";
import {
  buildTeamCatalogEvent,
  teamCatalogSnapshotIsStale,
  type TeamCatalogMemberSource,
} from "../agent-events";

const team = { name: "Support Crew", description: "Inbound", instructions: "Be nice." };

const member: TeamCatalogMemberSource = {
  displayName: "Helper",
  systemPrompt: "help",
  avatarUrl: null,
  runtime: null,
  model: "gpt-5",
  provider: "openrouter",
  namePool: [],
  respondTo: "anyone",
  parallelism: null,
};

function published(t = team, members: TeamCatalogMemberSource[] = [member]): string {
  return buildTeamCatalogEvent(t, members, "team-1", true, 1000).content;
}

describe("teamCatalogSnapshotIsStale", () => {
  it("is fresh when nothing changed", () => {
    expect(teamCatalogSnapshotIsStale(published(), team, [member])).toBe(false);
  });

  it("is key-order insensitive (structural comparison)", () => {
    const reordered = JSON.stringify(
      Object.fromEntries(Object.entries(JSON.parse(published()) as object).reverse()),
    );
    expect(teamCatalogSnapshotIsStale(reordered, team, [member])).toBe(false);
  });

  it("flags a renamed team", () => {
    expect(
      teamCatalogSnapshotIsStale(published(), { ...team, name: "New Name" }, [member]),
    ).toBe(true);
  });

  it("flags changed team instructions", () => {
    expect(
      teamCatalogSnapshotIsStale(published(), { ...team, instructions: "Be terse." }, [member]),
    ).toBe(true);
  });

  it("flags an edited member persona", () => {
    expect(
      teamCatalogSnapshotIsStale(published(), team, [{ ...member, systemPrompt: "help more" }]),
    ).toBe(true);
  });

  it("flags added or removed members", () => {
    expect(teamCatalogSnapshotIsStale(published(), team, [])).toBe(true);
    expect(teamCatalogSnapshotIsStale(published(), team, [member, member])).toBe(true);
  });

  it("ignores fields the projection sanitizes away (allowlist downgrade is stable)", () => {
    const allowlisted = { ...member, respondTo: "allowlist" };
    const head = published(team, [allowlisted]);
    // Re-checking against the same allowlisted member projects identically.
    expect(teamCatalogSnapshotIsStale(head, team, [allowlisted])).toBe(false);
  });

  it("treats unparseable published content as stale", () => {
    expect(teamCatalogSnapshotIsStale("not json", team, [member])).toBe(true);
  });
});
