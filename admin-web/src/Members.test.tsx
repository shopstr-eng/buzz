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
import { del, patch } from "./api";

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

describe("Members – removing state with mid-delete refresh", () => {
  it("shows 'Removing…' while del() is in-flight and clears it after del() resolves", async () => {
    const mockUseResource = vi.mocked(useResource as Mock);

    let resolveDel!: () => void;
    const delPromise = new Promise<void>((res) => {
      resolveDel = res;
    });
    vi.mocked(del as Mock).mockReturnValue(delPromise);

    const resource = makeResource([ALICE, BOB]);
    mockUseResource.mockReturnValue(resource);

    render(<Members />);

    // Open the remove confirmation for Alice
    fireEvent.click(screen.getByTitle(`Remove ${ALICE.pubkey}`));
    expect(screen.getByText("Remove?")).toBeInTheDocument();

    // Confirm → del() is called and held pending; no list refresh
    fireEvent.click(screen.getByText("Yes, remove"));

    // "Removing…" must be visible while del() is still in-flight
    expect(screen.getByText("Removing…")).toBeInTheDocument();
    // Bob's row is unaffected
    expect(screen.getByTitle(`Remove ${BOB.pubkey}`)).toBeInTheDocument();

    // Resolve del() — removing state should be cleared
    await act(async () => {
      resolveDel();
      await delPromise;
    });

    // "Removing…" label must be gone after del() settles
    expect(screen.queryByText("Removing…")).not.toBeInTheDocument();
    // Alice's normal Remove button reappears (member still in mocked list)
    expect(screen.getByTitle(`Remove ${ALICE.pubkey}`)).toBeInTheDocument();
  });

  it("leaves no stuck spinner or error banner when del() resolves after member drops from list", async () => {
    const mockUseResource = vi.mocked(useResource as Mock);

    let resolveDel!: () => void;
    const delPromise = new Promise<void>((res) => {
      resolveDel = res;
    });
    vi.mocked(del as Mock).mockReturnValue(delPromise);

    let resource = makeResource([ALICE, BOB]);
    mockUseResource.mockReturnValue(resource);

    const { rerender } = render(<Members />);

    // Open the remove confirmation for Alice
    fireEvent.click(screen.getByTitle(`Remove ${ALICE.pubkey}`));
    expect(screen.getByText("Remove?")).toBeInTheDocument();

    // Confirm → del() is called and held pending
    fireEvent.click(screen.getByText("Yes, remove"));

    // Simulate a list refresh that drops Alice while del() is still in-flight
    resource = makeResource([BOB]);
    mockUseResource.mockReturnValue(resource);
    act(() => {
      rerender(<Members />);
    });

    // Now resolve del() — Alice's row is already gone
    await act(async () => {
      resolveDel();
      await delPromise;
    });

    // No stuck "Removing…" label
    expect(screen.queryByText("Removing…")).not.toBeInTheDocument();
    // No error banner
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    // Bob's row still intact
    expect(screen.getByTitle(`Remove ${BOB.pubkey}`)).toBeInTheDocument();
  });

  it("leaves no stuck spinner or orphaned error banner when del() rejects after member drops from list", async () => {
    const mockUseResource = vi.mocked(useResource as Mock);

    let rejectDel!: (e: Error) => void;
    const delPromise = new Promise<void>((_, rej) => {
      rejectDel = rej;
    });
    vi.mocked(del as Mock).mockReturnValue(delPromise);

    let resource = makeResource([ALICE, BOB]);
    mockUseResource.mockReturnValue(resource);

    const { rerender } = render(<Members />);

    // Open the remove confirmation for Alice
    fireEvent.click(screen.getByTitle(`Remove ${ALICE.pubkey}`));
    expect(screen.getByText("Remove?")).toBeInTheDocument();

    // Confirm → del() is called and held pending
    fireEvent.click(screen.getByText("Yes, remove"));

    // Simulate a list refresh that drops Alice while del() is still in-flight
    resource = makeResource([BOB]);
    mockUseResource.mockReturnValue(resource);
    act(() => {
      rerender(<Members />);
    });

    // Now reject del() — Alice's row is already gone
    await act(async () => {
      rejectDel(new Error("Network error"));
      await delPromise.catch(() => {});
    });

    // No stuck "Removing…" label
    expect(screen.queryByText("Removing…")).not.toBeInTheDocument();
    // No orphaned error banner (member is already gone, error would be confusing)
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    // Bob's row still intact
    expect(screen.getByTitle(`Remove ${BOB.pubkey}`)).toBeInTheDocument();
  });
});

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

describe("Members – Cancel button on Remove? dialog", () => {
  it("dismisses the Remove? dialog without calling del()", () => {
    vi.clearAllMocks();
    const mockUseResource = vi.mocked(useResource as Mock);
    mockUseResource.mockReturnValue(makeResource([ALICE, BOB]));
    vi.mocked(del as Mock).mockResolvedValue(undefined);

    render(<Members />);

    // Open the remove confirmation for Alice
    fireEvent.click(screen.getByTitle(`Remove ${ALICE.pubkey}`));
    expect(screen.getByText("Remove?")).toBeInTheDocument();

    // Click Cancel
    fireEvent.click(screen.getByText("Cancel"));

    // del() must never have been called
    expect(vi.mocked(del as Mock)).not.toHaveBeenCalled();

    // The "Remove?" confirmation must be gone
    expect(screen.queryByText("Remove?")).not.toBeInTheDocument();

    // Alice's Remove button must be back and enabled
    const aliceRemoveBtn = screen.getByTitle(`Remove ${ALICE.pubkey}`);
    expect(aliceRemoveBtn).toBeInTheDocument();
    expect(aliceRemoveBtn).not.toBeDisabled();
  });
});

describe("Members – role-change dropdown disabled during removal", () => {
  it("disables the role-change select for every member while del() is in-flight", async () => {
    const mockUseResource = vi.mocked(useResource as Mock);

    let resolveDel!: () => void;
    const delPromise = new Promise<void>((res) => {
      resolveDel = res;
    });
    vi.mocked(del as Mock).mockReturnValue(delPromise);

    const resource = makeResource([ALICE, BOB]);
    mockUseResource.mockReturnValue(resource);

    render(<Members />);

    // Open the remove confirmation for Alice
    fireEvent.click(screen.getByTitle(`Remove ${ALICE.pubkey}`));
    expect(screen.getByText("Remove?")).toBeInTheDocument();

    // Confirm → del() is called and held pending
    fireEvent.click(screen.getByText("Yes, remove"));

    // Bob's role-change select must be disabled while del() is in-flight
    const bobSelect = screen.getByRole("combobox", {
      name: new RegExp(BOB.pubkey.slice(0, 8), "i"),
    });
    expect(bobSelect).toBeDisabled();

    // Resolve del() — Bob's role-change select should return to enabled
    await act(async () => {
      resolveDel();
      await delPromise;
    });

    expect(bobSelect).not.toBeDisabled();
  });
});

describe("Members – changeRole state with mid-patch refresh", () => {
  it("leaves no orphaned error banner when patch() rejects after member drops from list", async () => {
    const mockUseResource = vi.mocked(useResource as Mock);

    let rejectPatch!: (e: Error) => void;
    const patchPromise = new Promise<void>((_, rej) => {
      rejectPatch = rej;
    });
    vi.mocked(patch as Mock).mockReturnValue(patchPromise);

    let resource = makeResource([ALICE, BOB]);
    mockUseResource.mockReturnValue(resource);

    const { rerender } = render(<Members />);

    // Change Alice's role — patch() is called and held pending
    const aliceSelect = screen.getByRole("combobox", {
      name: new RegExp(ALICE.pubkey.slice(0, 8), "i"),
    });
    fireEvent.change(aliceSelect, { target: { value: "admin" } });

    // Simulate a list refresh that drops Alice while patch() is still in-flight
    resource = makeResource([BOB]);
    mockUseResource.mockReturnValue(resource);
    act(() => {
      rerender(<Members />);
    });

    // Now reject patch() — Alice's row is already gone
    await act(async () => {
      rejectPatch(new Error("Network error"));
      await patchPromise.catch(() => {});
    });

    // No orphaned error banner (member is already gone, error would be confusing)
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    // Bob's row still intact
    expect(screen.getByTitle(`Remove ${BOB.pubkey}`)).toBeInTheDocument();
  });
});
