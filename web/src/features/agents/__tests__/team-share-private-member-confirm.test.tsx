/**
 * Guards TeamShareDialog's private-persona share confirms
 * (confirmPrivateMembersShare): export, copy-link, and DM-send must each
 * prompt via window.confirm when the team includes a private (unshared)
 * member persona, must abort when the user declines, and must not prompt
 * when every member is individually shared. A refactor that drops any of
 * the three confirm call sites fails these tests.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AgentPersona, AgentTeam } from "../use-agents";

const uploadMediaBytes = vi.fn().mockResolvedValue({
  url: "https://relay.example/blob/abc",
  sha256: "ab".repeat(32),
  size: 3,
  type: "application/json",
});
const downloadBytes = vi.fn();
const publishAndWait = vi.fn().mockResolvedValue(undefined);
const signFn = vi.fn().mockResolvedValue({ id: "ev" });

vi.mock("@/shared/context/relay-context", () => ({
  useRelay: () => ({
    connection: { publishAndWait, subscribe: () => () => {} },
    connectionState: "ready",
    identity: { pubkey: "ff".repeat(32) },
  }),
}));
vi.mock("@/shared/lib/identity", () => ({
  getSignFn: () => signFn,
}));
vi.mock("@/shared/lib/blossom-upload", () => ({
  uploadMediaBytes: (...args: unknown[]) => uploadMediaBytes(...args),
}));
vi.mock("../../channels/use-channels", () => ({
  useChannels: () => ({ channels: [] }),
}));
vi.mock("../../dms/use-open-dm", () => ({
  findDmChannel: () => ({ groupId: "dm-group" }),
  useOpenDm: () => ({ openDm: vi.fn().mockResolvedValue(true) }),
}));
vi.mock("../../dms/use-community-people", () => ({
  useCommunityPeople: () => [{ pubkey: "dd".repeat(32), name: "Dana" }],
}));
vi.mock("../lib/snapshot-download", () => ({
  dataUrlToBytes: () => null,
  downloadBytes: (...args: unknown[]) => downloadBytes(...args),
}));
vi.mock("../lib/png-text-chunk", () => ({
  TEAM_PNG_CHUNK_KEYWORD: "buzz_team_snapshot",
  encodePngWithSnapshotJson: () => new Uint8Array([1, 2, 3]),
}));

import { TeamShareDialog } from "../ui/TeamShareDialog";

function persona(id: string, shared: boolean): AgentPersona {
  return {
    id,
    displayName: `Persona ${id}`,
    avatarUrl: null,
    systemPrompt: "secret instructions",
    runtime: null,
    model: null,
    provider: null,
    isBuiltIn: false,
    respondTo: null,
    shared,
    namePool: [],
    parallelism: null,
    respondToAllowlist: [],
  };
}

const team: AgentTeam = {
  id: "team-1",
  name: "Alpha Team",
  description: null,
  instructions: null,
  personaIds: ["p1", "p2"],
  version: "1",
};

function renderDialog(members: AgentPersona[]) {
  return render(
    <TeamShareDialog
      team={team}
      members={members}
      missingMemberCount={0}
      shared={false}
      isStale={false}
      isPublishing={false}
      publishError={null}
      onSharedChange={() => {}}
      onClose={() => {}}
    />,
  );
}

/** Add the mocked community person "Dana" as a DM recipient. */
function addRecipient() {
  fireEvent.change(screen.getByTestId("team-share-recipient-search"), {
    target: { value: "Dana" },
  });
  fireEvent.click(screen.getByTestId("team-share-person-dddddddd"));
}

let confirmSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  confirmSpy = vi.spyOn(window, "confirm");
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
});

afterEach(() => {
  vi.restoreAllMocks();
  uploadMediaBytes.mockClear();
  downloadBytes.mockClear();
  publishAndWait.mockClear();
});

const privateTeam = [persona("p1", true), persona("p2", false)];
const sharedTeam = [persona("p1", true), persona("p2", true)];

describe("TeamShareDialog private-persona confirms", () => {
  describe("export", () => {
    it("prompts and aborts when declined (private member present)", () => {
      confirmSpy.mockReturnValue(false);
      renderDialog(privateTeam);

      fireEvent.click(screen.getByTestId("team-share-export"));

      expect(confirmSpy).toHaveBeenCalledTimes(1);
      expect(confirmSpy.mock.calls[0]?.[0]).toContain("Share private personas?");
      expect(downloadBytes).not.toHaveBeenCalled();
    });

    it("proceeds after the user confirms", () => {
      confirmSpy.mockReturnValue(true);
      renderDialog(privateTeam);

      fireEvent.click(screen.getByTestId("team-share-export"));

      expect(confirmSpy).toHaveBeenCalledTimes(1);
      expect(downloadBytes).toHaveBeenCalledTimes(1);
    });

    it("does not prompt when all members are shared", () => {
      renderDialog(sharedTeam);

      fireEvent.click(screen.getByTestId("team-share-export"));
      fireEvent.click(screen.getByTestId("team-share-export-png"));

      expect(confirmSpy).not.toHaveBeenCalled();
      expect(downloadBytes).toHaveBeenCalledTimes(2);
    });
  });

  describe("copy link", () => {
    it("prompts and aborts the upload when declined (private member present)", async () => {
      confirmSpy.mockReturnValue(false);
      renderDialog(privateTeam);

      fireEvent.click(screen.getByTestId("team-share-copy-link"));

      expect(confirmSpy).toHaveBeenCalledTimes(1);
      expect(confirmSpy.mock.calls[0]?.[0]).toContain("Share private personas?");
      expect(uploadMediaBytes).not.toHaveBeenCalled();
    });

    it("uploads after the user confirms", async () => {
      confirmSpy.mockReturnValue(true);
      renderDialog(privateTeam);

      fireEvent.click(screen.getByTestId("team-share-copy-link"));

      expect(confirmSpy).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(uploadMediaBytes).toHaveBeenCalledTimes(1));
    });

    it("does not prompt when all members are shared", async () => {
      renderDialog(sharedTeam);

      fireEvent.click(screen.getByTestId("team-share-copy-link"));

      expect(confirmSpy).not.toHaveBeenCalled();
      await waitFor(() => expect(uploadMediaBytes).toHaveBeenCalledTimes(1));
    });
  });

  describe("DM send", () => {
    it("prompts (naming the recipient) and aborts when declined", async () => {
      confirmSpy.mockReturnValue(false);
      renderDialog(privateTeam);
      addRecipient();

      fireEvent.click(screen.getByTestId("team-share-send"));

      expect(confirmSpy).toHaveBeenCalledTimes(1);
      expect(confirmSpy.mock.calls[0]?.[0]).toContain("Share private personas?");
      expect(confirmSpy.mock.calls[0]?.[0]).toContain("Dana");
      expect(uploadMediaBytes).not.toHaveBeenCalled();
      expect(publishAndWait).not.toHaveBeenCalled();
    });

    it("uploads and sends after the user confirms", async () => {
      confirmSpy.mockReturnValue(true);
      renderDialog(privateTeam);
      addRecipient();

      fireEvent.click(screen.getByTestId("team-share-send"));

      expect(confirmSpy).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(publishAndWait).toHaveBeenCalledTimes(1));
      expect(uploadMediaBytes).toHaveBeenCalledTimes(1);
    });

    it("does not prompt when all members are shared", async () => {
      renderDialog(sharedTeam);
      addRecipient();

      fireEvent.click(screen.getByTestId("team-share-send"));

      expect(confirmSpy).not.toHaveBeenCalled();
      await waitFor(() => expect(publishAndWait).toHaveBeenCalledTimes(1));
    });
  });
});
