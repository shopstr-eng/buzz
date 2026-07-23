import { render, screen, act, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi, type Mock } from "vitest";
import { Members } from "./App";
import type { Resource } from "./useResource";
import type { RelayMember } from "./types";

// ---------------------------------------------------------------------------
// Mock ./useResource so we can swap the member list between renders
// ---------------------------------------------------------------------------
vi.mock("./useResource");
vi.mock("./api");

import { useResource } from "./useResource";
import { del } from "./api";

const ALICE: RelayMember = {
  pubkey: "aa".repeat(32),
  role: "member",
  createdAt: "2026-01-01T00:00:00Z",
};

const BOB: RelayMember = {
  pubkey: "bb".repeat(32),
  role: "member",
  createdAt: "2026-01-01T00:00:00Z",
};

function makeResource(members: RelayMember[]): Resource<RelayMember[]> {
  return {
    data: members,
    loading: false,
    stale: false,
    error: undefined,
    refetch: vi.fn(),
  };
}

describe("Members – confirmingRemove auto-clear", () => {
  it("clears the Remove? confirmation when the member disappears from a refreshed list", async () => {
    // Start: both Alice and Bob are present
    const mockUseResource = vi.mocked(useResource as Mock);
    let resource = makeResource([ALICE, BOB]);
    mockUseResource.mockReturnValue(resource);

    // del() should never actually be called in this scenario
    vi.mocked(del as Mock).mockResolvedValue(undefined);

    const { rerender } = render(<Members />);

    // Confirm Alice's remove button is visible
    const aliceRemoveBtn = screen.getByTitle(`Remove ${ALICE.pubkey}`);
    expect(aliceRemoveBtn).toBeInTheDocument();

    // Admin clicks Remove → confirmation prompt appears
    fireEvent.click(aliceRemoveBtn);
    expect(screen.getByText("Remove?")).toBeInTheDocument();

    // Another admin removes Alice; the member list now only contains Bob.
    // Simulate the component receiving the updated resource (e.g. after polling
    // or a manual refetch triggered elsewhere).
    resource = makeResource([BOB]);
    mockUseResource.mockReturnValue(resource);

    // Re-render with the new resource data — equivalent to React re-rendering
    // after the parent passes updated props / hook state changes.
    act(() => {
      rerender(<Members />);
    });

    // The "Remove?" confirmation must have been cleared automatically.
    expect(screen.queryByText("Remove?")).not.toBeInTheDocument();

    // The Remove button for Bob (who is still present) must still be visible
    // so the UI isn't broken.
    expect(screen.getByTitle(`Remove ${BOB.pubkey}`)).toBeInTheDocument();
  });

  it("keeps the Remove? confirmation when the member is still in the refreshed list", async () => {
    const mockUseResource = vi.mocked(useResource as Mock);
    let resource = makeResource([ALICE, BOB]);
    mockUseResource.mockReturnValue(resource);

    const { rerender } = render(<Members />);

    fireEvent.click(screen.getByTitle(`Remove ${ALICE.pubkey}`));
    expect(screen.getByText("Remove?")).toBeInTheDocument();

    // The list refreshes but Alice is still there
    resource = makeResource([ALICE, BOB]);
    mockUseResource.mockReturnValue(resource);

    act(() => {
      rerender(<Members />);
    });

    // Confirmation must remain visible
    expect(screen.getByText("Remove?")).toBeInTheDocument();
  });
});
