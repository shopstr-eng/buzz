/**
 * Regression tests for the team-import rollback contract in
 * use-team-snapshot-import.ts:
 *
 * - When a publish fails midway (member persona or the team event),
 *   already-published member personas are rolled back via deletePersona and
 *   the error tells the user it's safe to retry.
 * - When rollback itself partially fails, the error names the leftover
 *   member slugs so the user can remove them manually before retrying.
 * - When nothing was published yet, no rollback deletes are issued.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

const savePersona = vi.fn();
const saveTeam = vi.fn();
const deletePersona = vi.fn();

vi.mock("../use-agents", () => ({
  useAgentDirectory: () => ({ personas: [] }),
}));

vi.mock("../use-agent-publishing", () => ({
  useAgentPublishing: () => ({ savePersona, saveTeam, deletePersona }),
}));

import { useTeamSnapshotImport } from "../use-team-snapshot-import";

function member(name: string) {
  return {
    format: "buzz-agent-snapshot",
    version: 1,
    definition: { name, systemPrompt: "You are helpful." },
    profile: { displayName: name },
  };
}

function teamJson(memberNames: string[]): string {
  return JSON.stringify({
    format: "buzz-team-snapshot",
    version: 1,
    team: { name: "Import Squad" },
    members: memberNames.map(member),
  });
}

function importer() {
  const { result } = renderHook(() => useTeamSnapshotImport());
  return result.current.importTeamSnapshot;
}

beforeEach(() => {
  savePersona.mockReset();
  saveTeam.mockReset();
  deletePersona.mockReset();
});

describe("useTeamSnapshotImport rollback on mid-import failure", () => {
  it("deletes already-created personas and says it's safe to retry when a member publish fails", async () => {
    savePersona
      .mockResolvedValueOnce("alice")
      .mockResolvedValueOnce("bob")
      .mockRejectedValueOnce(new Error("relay rejected event"));
    deletePersona.mockResolvedValue(undefined);

    await expect(importer()(teamJson(["Alice", "Bob", "Carol"]))).rejects.toThrow(
      /Team import failed: relay rejected event.*safe to retry/,
    );

    expect(saveTeam).not.toHaveBeenCalled();
    expect(deletePersona).toHaveBeenCalledTimes(2);
    expect(deletePersona).toHaveBeenNthCalledWith(1, "alice");
    expect(deletePersona).toHaveBeenNthCalledWith(2, "bob");
  });

  it("rolls back all members when the team publish fails after every member succeeded", async () => {
    savePersona.mockResolvedValueOnce("alice").mockResolvedValueOnce("bob");
    saveTeam.mockRejectedValueOnce(new Error("team publish failed"));
    deletePersona.mockResolvedValue(undefined);

    await expect(importer()(teamJson(["Alice", "Bob"]))).rejects.toThrow(
      /team publish failed.*Already-created members were removed, so it's safe to retry/,
    );

    expect(deletePersona).toHaveBeenCalledTimes(2);
    expect(deletePersona).toHaveBeenNthCalledWith(1, "alice");
    expect(deletePersona).toHaveBeenNthCalledWith(2, "bob");
  });

  it("names the leftover members when rollback itself partially fails", async () => {
    savePersona
      .mockResolvedValueOnce("alice")
      .mockResolvedValueOnce("bob")
      .mockRejectedValueOnce(new Error("boom"));
    // alice delete fails, bob delete succeeds — alice is left behind.
    deletePersona
      .mockRejectedValueOnce(new Error("delete failed"))
      .mockResolvedValueOnce(undefined);

    await expect(importer()(teamJson(["Alice", "Bob", "Carol"]))).rejects.toThrow(
      /Cleanup couldn't remove 1 already-created member \(alice\) — remove them from Agents before retrying/,
    );
    expect(deletePersona).toHaveBeenCalledTimes(2);
  });

  it("pluralizes and lists every leftover member when no deletes succeed", async () => {
    savePersona
      .mockResolvedValueOnce("alice")
      .mockResolvedValueOnce("bob")
      .mockRejectedValueOnce(new Error("boom"));
    deletePersona.mockRejectedValue(new Error("relay down"));

    await expect(importer()(teamJson(["Alice", "Bob", "Carol"]))).rejects.toThrow(
      /Cleanup couldn't remove 2 already-created members \(alice, bob\)/,
    );
  });

  it("issues no rollback deletes when the very first publish fails", async () => {
    savePersona.mockRejectedValueOnce(new Error("first publish failed"));

    await expect(importer()(teamJson(["Alice"]))).rejects.toThrow(
      "Team import failed: first publish failed",
    );
    expect(deletePersona).not.toHaveBeenCalled();
    expect(saveTeam).not.toHaveBeenCalled();
  });
});
