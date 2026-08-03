/**
 * Guards PersonaShareDialog's plaintext-memory share confirms
 * (confirmMemoryShare): export (.json and .png), copy-link, and DM-send must
 * each prompt via window.confirm when the snapshot includes memories, must
 * abort when the user declines, and must not prompt when no memories are
 * shared. A refactor that drops any of the confirm call sites fails these
 * tests.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AgentPersona } from "../use-agents";
import type { MemoryGraph } from "../lib/engrams";

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
  AGENT_PNG_CHUNK_KEYWORD: "buzz_agent_snapshot",
  encodePngWithSnapshotJson: () => new Uint8Array([1, 2, 3]),
}));

import { PersonaShareDialog } from "../ui/PersonaShareDialog";

const persona: AgentPersona = {
  id: "p1",
  displayName: "Persona p1",
  avatarUrl: null,
  systemPrompt: "secret instructions",
  runtime: null,
  model: null,
  provider: null,
  isBuiltIn: false,
  respondTo: null,
  shared: false,
  namePool: [],
  parallelism: null,
  respondToAllowlist: [],
};

const memoryGraph: MemoryGraph = {
  core: { slug: "core", text: "core memory body", refs: [] },
  reachable: new Map([["core", { slug: "core", text: "core memory body", refs: [] }]]),
  orphans: [],
  danglingRefs: [],
};

function renderDialog(graph: MemoryGraph | null) {
  return render(
    <PersonaShareDialog
      persona={persona}
      memoryGraph={graph}
      isPublishing={false}
      publishError={null}
      onCatalogSharedChange={() => {}}
      onClose={() => {}}
    />,
  );
}

/** Bump "What's included" so the snapshot bundles memories. */
function selectMemoryLevel(level: "core" | "everything") {
  fireEvent.change(screen.getByTestId("persona-share-level"), {
    target: { value: level },
  });
}

/** Add the mocked community person "Dana" as a DM recipient. */
function addRecipient() {
  fireEvent.change(screen.getByTestId("persona-share-recipient-search"), {
    target: { value: "Dana" },
  });
  fireEvent.click(screen.getByTestId("persona-share-person-dddddddd"));
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

describe("PersonaShareDialog memory-share confirms", () => {
  describe("export", () => {
    it("prompts and aborts when declined (memories included)", () => {
      confirmSpy.mockReturnValue(false);
      renderDialog(memoryGraph);
      selectMemoryLevel("core");

      fireEvent.click(screen.getByTestId("persona-share-export"));
      fireEvent.click(screen.getByTestId("persona-share-export-png"));

      expect(confirmSpy).toHaveBeenCalledTimes(2);
      expect(confirmSpy.mock.calls[0]?.[0]).toContain("Share memories?");
      expect(confirmSpy.mock.calls[0]?.[0]).toContain("core memory");
      expect(downloadBytes).not.toHaveBeenCalled();
    });

    it("proceeds after the user confirms", () => {
      confirmSpy.mockReturnValue(true);
      renderDialog(memoryGraph);
      selectMemoryLevel("everything");

      fireEvent.click(screen.getByTestId("persona-share-export"));

      expect(confirmSpy).toHaveBeenCalledTimes(1);
      expect(confirmSpy.mock.calls[0]?.[0]).toContain("all memories");
      expect(downloadBytes).toHaveBeenCalledTimes(1);
    });

    it("does not prompt when no memories are shared", () => {
      renderDialog(null);

      fireEvent.click(screen.getByTestId("persona-share-export"));
      fireEvent.click(screen.getByTestId("persona-share-export-png"));

      expect(confirmSpy).not.toHaveBeenCalled();
      expect(downloadBytes).toHaveBeenCalledTimes(2);
    });
  });

  describe("copy link", () => {
    it("prompts and aborts the upload when declined (memories included)", () => {
      confirmSpy.mockReturnValue(false);
      renderDialog(memoryGraph);
      selectMemoryLevel("core");

      fireEvent.click(screen.getByTestId("persona-share-copy-link"));

      expect(confirmSpy).toHaveBeenCalledTimes(1);
      expect(confirmSpy.mock.calls[0]?.[0]).toContain("Share memories?");
      expect(confirmSpy.mock.calls[0]?.[0]).toContain("Anyone with the link");
      expect(uploadMediaBytes).not.toHaveBeenCalled();
    });

    it("uploads after the user confirms", async () => {
      confirmSpy.mockReturnValue(true);
      renderDialog(memoryGraph);
      selectMemoryLevel("core");

      fireEvent.click(screen.getByTestId("persona-share-copy-link"));

      expect(confirmSpy).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(uploadMediaBytes).toHaveBeenCalledTimes(1));
    });

    it("does not prompt when no memories are shared", async () => {
      renderDialog(null);

      fireEvent.click(screen.getByTestId("persona-share-copy-link"));

      expect(confirmSpy).not.toHaveBeenCalled();
      await waitFor(() => expect(uploadMediaBytes).toHaveBeenCalledTimes(1));
    });
  });

  describe("DM send", () => {
    it("prompts (naming the recipient) and aborts when declined", () => {
      confirmSpy.mockReturnValue(false);
      renderDialog(memoryGraph);
      selectMemoryLevel("everything");
      addRecipient();

      fireEvent.click(screen.getByTestId("persona-share-send"));

      expect(confirmSpy).toHaveBeenCalledTimes(1);
      expect(confirmSpy.mock.calls[0]?.[0]).toContain("Share memories?");
      expect(confirmSpy.mock.calls[0]?.[0]).toContain("Dana");
      expect(uploadMediaBytes).not.toHaveBeenCalled();
      expect(publishAndWait).not.toHaveBeenCalled();
    });

    it("uploads and sends after the user confirms", async () => {
      confirmSpy.mockReturnValue(true);
      renderDialog(memoryGraph);
      selectMemoryLevel("core");
      addRecipient();

      fireEvent.click(screen.getByTestId("persona-share-send"));

      expect(confirmSpy).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(publishAndWait).toHaveBeenCalledTimes(1));
      expect(uploadMediaBytes).toHaveBeenCalledTimes(1);
    });

    it("does not prompt when no memories are shared", async () => {
      renderDialog(null);
      addRecipient();

      fireEvent.click(screen.getByTestId("persona-share-send"));

      expect(confirmSpy).not.toHaveBeenCalled();
      await waitFor(() => expect(publishAndWait).toHaveBeenCalledTimes(1));
    });
  });
});
