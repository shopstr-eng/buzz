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
  it("keeps the role-change select disabled until the post-removal refetch delivers fresh data", async () => {
    const mockUseResource = vi.mocked(useResource as Mock);

    let resolveDel!: () => void;
    const delPromise = new Promise<void>((res) => {
      resolveDel = res;
    });
    vi.mocked(del as Mock).mockReturnValue(delPromise);

    // Use a stable array reference — the anchor comparison relies on identity
    const initialMembers: RelayMember[] = [ALICE, BOB];
    const resource = makeResource(initialMembers);
    mockUseResource.mockReturnValue(resource);

    const { rerender } = render(<Members />);

    // Open the remove confirmation for Alice
    fireEvent.click(screen.getByTitle(`Remove ${ALICE.pubkey}`));
    expect(screen.getByText("Remove?")).toBeInTheDocument();

    // Confirm → del() is called and held pending
    fireEvent.click(screen.getByText("Yes, remove"));

    // Resolve del() — removing state is cleared but refetch anchor is set to
    // the current data array (initialMembers)
    await act(async () => {
      resolveDel();
      await delPromise;
    });

    // Simulate mid-refetch: same data array reference, only stale flag changes.
    // resource.data is still initialMembers so the anchor comparison holds.
    const staleResource = { ...resource, stale: true };
    mockUseResource.mockReturnValue(staleResource);
    act(() => {
      rerender(<Members />);
    });

    // Bob's role-change select must STILL be disabled — del() has settled but
    // the fresh member list hasn't arrived yet (anchor not yet cleared).
    const bobSelectMid = screen.getByRole("combobox", {
      name: new RegExp(BOB.pubkey.slice(0, 8), "i"),
    });
    expect(bobSelectMid).toBeDisabled();

    // Refetch completes — new array reference (Alice gone) clears the anchor
    const freshResource = makeResource([BOB]);
    mockUseResource.mockReturnValue(freshResource);
    act(() => {
      rerender(<Members />);
    });

    // Anchor cleared → select is now enabled
    const bobSelectAfter = screen.getByRole("combobox", {
      name: new RegExp(BOB.pubkey.slice(0, 8), "i"),
    });
    expect(bobSelectAfter).not.toBeDisabled();
  });

  it("never briefly enables the select on stale data when the component remounts mid-refetch (page reload)", async () => {
    const mockUseResource = vi.mocked(useResource as Mock);

    let resolveDel!: () => void;
    const delPromise = new Promise<void>((res) => {
      resolveDel = res;
    });
    vi.mocked(del as Mock).mockReturnValue(delPromise);

    // Phase 1: mount the component and trigger a removal
    const initialMembers: RelayMember[] = [ALICE, BOB];
    const resource = makeResource(initialMembers);
    mockUseResource.mockReturnValue(resource);

    const { unmount } = render(<Members />);

    fireEvent.click(screen.getByTitle(`Remove ${ALICE.pubkey}`));
    expect(screen.getByText("Remove?")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Yes, remove"));

    // Resolve del() — in a real app the anchor would now be set and refetch
    // in-flight; we're about to simulate a page reload before it lands.
    await act(async () => {
      resolveDel();
      await delPromise;
    });

    // Phase 2: simulate a hard page reload — unmount the original component
    // entirely.  The removalRefetchAnchor and all other per-component state
    // is now gone.
    unmount();

    // Phase 3: remount as a completely new instance — useResource is called
    // fresh and returns the loading skeleton (data undefined, loading true).
    // This mirrors what the browser does on a hard reload before the first
    // network response arrives.
    const loadingResource: Resource<RelayMember[]> = {
      data: undefined,
      loading: true,
      stale: false,
      error: undefined,
      refetch: vi.fn(),
    };
    mockUseResource.mockReturnValue(loadingResource);
    render(<Members />);

    // While the first response is still in-flight the table is not rendered
    // at all (StateView shows its "Loading…" placeholder), so there is no
    // window in which a stale select could be briefly enabled.
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();

    // Phase 4: fresh data arrives on the remounted instance.  A new array
    // reference is used (Alice gone) — the select must now be enabled with no
    // disabled guard because the new instance has no anchor state.
    const freshResource = makeResource([BOB]);
    mockUseResource.mockReturnValue(freshResource);
    act(() => {
      // Re-render the already-mounted second instance with fresh data
      // (same pattern used by other tests: re-render with updated mock).
      render(<Members />);
    });

    const bobSelect = screen.getAllByRole("combobox", {
      name: new RegExp(BOB.pubkey.slice(0, 8), "i"),
    })[0];
    expect(bobSelect).not.toBeDisabled();
  });

  it("keeps the role-change select disabled when fast cache returns stale member list instantly on remount", async () => {
    const mockUseResource = vi.mocked(useResource as Mock);

    let resolveDel!: () => void;
    const delPromise = new Promise<void>((res) => {
      resolveDel = res;
    });
    vi.mocked(del as Mock).mockReturnValue(delPromise);

    // Phase 1: mount and trigger a removal
    const initialMembers: RelayMember[] = [ALICE, BOB];
    const resource = makeResource(initialMembers);
    mockUseResource.mockReturnValue(resource);

    const { unmount } = render(<Members />);

    fireEvent.click(screen.getByTitle(`Remove ${ALICE.pubkey}`));
    expect(screen.getByText("Remove?")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Yes, remove"));

    // Resolve del() — anchor is set, refetch in-flight
    await act(async () => {
      resolveDel();
      await delPromise;
    });

    // Phase 2: simulate a hard page reload — unmount clears all component state
    unmount();

    // Phase 3: remount as a completely new instance.  This time a CDN / edge
    // cache returns the pre-removal list immediately (stale: true) so
    // useResource sets data right away without going through the
    // data=undefined loading skeleton.  The fresh fetch is still in-flight.
    const staleCacheResource: Resource<RelayMember[]> = {
      data: [ALICE, BOB], // stale pre-removal list
      loading: true,
      stale: true,        // fast cache hit — fresh fetch not yet complete
      error: undefined,
      refetch: vi.fn(),
    };
    mockUseResource.mockReturnValue(staleCacheResource);
    const { rerender } = render(<Members />);

    // The table is rendered (data is defined) but the role-change selects must
    // be disabled while stale data is being served — the removal may not yet
    // be reflected.
    const aliceSelectStale = screen.getByRole("combobox", {
      name: new RegExp(ALICE.pubkey.slice(0, 8), "i"),
    });
    expect(aliceSelectStale).toBeDisabled();

    const bobSelectStale = screen.getByRole("combobox", {
      name: new RegExp(BOB.pubkey.slice(0, 8), "i"),
    });
    expect(bobSelectStale).toBeDisabled();

    // Phase 4: fresh data arrives — Alice is gone, stale clears
    const freshResource = makeResource([BOB]);
    mockUseResource.mockReturnValue(freshResource);
    act(() => {
      rerender(<Members />);
    });

    // Alice's row is gone; Bob's select is now enabled
    expect(screen.queryByRole("combobox", {
      name: new RegExp(ALICE.pubkey.slice(0, 8), "i"),
    })).not.toBeInTheDocument();

    const bobSelectFresh = screen.getByRole("combobox", {
      name: new RegExp(BOB.pubkey.slice(0, 8), "i"),
    });
    expect(bobSelectFresh).not.toBeDisabled();
  });

  it("disables the role-change select for every member while del() is in-flight", async () => {
    const mockUseResource = vi.mocked(useResource as Mock);

    let resolveDel!: () => void;
    const delPromise = new Promise<void>((res) => {
      resolveDel = res;
    });
    vi.mocked(del as Mock).mockReturnValue(delPromise);

    const resource = makeResource([ALICE, BOB]);
    mockUseResource.mockReturnValue(resource);

    const { rerender } = render(<Members />);

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

    // Resolve del() — removing flag clears but refetch anchor is set;
    // the select stays disabled until fresh data arrives.
    await act(async () => {
      resolveDel();
      await delPromise;
    });

    // Simulate the refetch completing: deliver a new array reference so the
    // anchor comparison fires and re-enables the select.
    const freshResource = makeResource([ALICE, BOB]);
    mockUseResource.mockReturnValue(freshResource);
    act(() => {
      rerender(<Members />);
    });

    expect(bobSelect).not.toBeDisabled();
  });
});

describe("Members – changeRole state with mid-patch refresh", () => {
  it("does not revert the displayed role to the pre-change value when a mid-patch refetch delivers stale data", async () => {
    const mockUseResource = vi.mocked(useResource as Mock);

    let resolvePatch!: () => void;
    const patchPromise = new Promise<void>((res) => {
      resolvePatch = res;
    });
    vi.mocked(patch as Mock).mockReturnValue(patchPromise);

    // Alice starts as "member"
    const initialMembers: RelayMember[] = [
      { ...ALICE, role: "member" },
      BOB,
    ];
    let resource = makeResource(initialMembers);
    mockUseResource.mockReturnValue(resource);

    const { rerender } = render(<Members />);

    // Change Alice's role to "admin" — patch() is held pending
    const aliceSelect = screen.getByRole("combobox", {
      name: new RegExp(ALICE.pubkey.slice(0, 8), "i"),
    });
    fireEvent.change(aliceSelect, { target: { value: "admin" } });

    // Simulate a mid-patch refetch that delivers stale data (Alice still "member")
    resource = makeResource([{ ...ALICE, role: "member" }, BOB]);
    mockUseResource.mockReturnValue(resource);
    act(() => {
      rerender(<Members />);
    });

    // The select must show the optimistic "admin" value — it must NOT revert
    // to "member" while patch() is still in-flight.
    const aliceSelectAfterRefetch = screen.getByRole("combobox", {
      name: new RegExp(ALICE.pubkey.slice(0, 8), "i"),
    });
    expect(aliceSelectAfterRefetch).toHaveValue("admin");

    // Resolve patch() so the test cleans up without pending async work
    await act(async () => {
      resolvePatch();
      await patchPromise;
    });
  });

  it("keeps showing the optimistic role after patch() resolves and before fresh data arrives (no stale-value flash)", async () => {
    const mockUseResource = vi.mocked(useResource as Mock);

    let resolvePatch!: () => void;
    const patchPromise = new Promise<void>((res) => {
      resolvePatch = res;
    });
    vi.mocked(patch as Mock).mockReturnValue(patchPromise);

    // Use a stable array reference — the anchor comparison relies on identity
    const initialMembers: RelayMember[] = [
      { ...ALICE, role: "member" },
      BOB,
    ];
    const resource = makeResource(initialMembers);
    mockUseResource.mockReturnValue(resource);

    const { rerender } = render(<Members />);

    // Change Alice's role to "admin" — patch() is held pending
    const aliceSelect = screen.getByRole("combobox", {
      name: new RegExp(ALICE.pubkey.slice(0, 8), "i"),
    });
    fireEvent.change(aliceSelect, { target: { value: "admin" } });

    // Resolve patch() — updatingRole is cleared but roleRefetchAnchor is set;
    // optimisticRole must stay alive so the select value doesn't flash back
    // to the stale server value ("member") before fresh data arrives.
    await act(async () => {
      resolvePatch();
      await patchPromise;
    });

    // Simulate mid-refetch: same data array reference, only stale flag changes.
    // resource.data is still initialMembers (Alice still "member" in server data)
    // so the anchor comparison holds — the select must be disabled AND still
    // show "admin", not revert to "member".
    const staleResource = { ...resource, stale: true };
    mockUseResource.mockReturnValue(staleResource);
    act(() => {
      rerender(<Members />);
    });

    const aliceSelectMid = screen.getByRole("combobox", {
      name: new RegExp(ALICE.pubkey.slice(0, 8), "i"),
    });
    // Must show the optimistic value, not the stale server value
    expect(aliceSelectMid).toHaveValue("admin");
    // And still be disabled while the refetch is in-flight
    expect(aliceSelectMid).toBeDisabled();

    // Refetch completes — new array reference (Alice now "admin" from server)
    const freshMembers: RelayMember[] = [{ ...ALICE, role: "admin" }, BOB];
    const freshResource = makeResource(freshMembers);
    mockUseResource.mockReturnValue(freshResource);
    act(() => {
      rerender(<Members />);
    });

    // Anchor cleared → select is re-enabled and shows the confirmed server value
    const aliceSelectAfter = screen.getByRole("combobox", {
      name: new RegExp(ALICE.pubkey.slice(0, 8), "i"),
    });
    expect(aliceSelectAfter).not.toBeDisabled();
    expect(aliceSelectAfter).toHaveValue("admin");
  });

  it("keeps the role-change select disabled during the post-patch refetch until fresh data arrives", async () => {
    const mockUseResource = vi.mocked(useResource as Mock);

    let resolvePatch!: () => void;
    const patchPromise = new Promise<void>((res) => {
      resolvePatch = res;
    });
    vi.mocked(patch as Mock).mockReturnValue(patchPromise);

    // Use a stable array reference so the anchor comparison works
    const initialMembers: RelayMember[] = [
      { ...ALICE, role: "member" },
      BOB,
    ];
    const resource = makeResource(initialMembers);
    mockUseResource.mockReturnValue(resource);

    const { rerender } = render(<Members />);

    // Change Alice's role — patch() is called and held pending
    const aliceSelect = screen.getByRole("combobox", {
      name: new RegExp(ALICE.pubkey.slice(0, 8), "i"),
    });
    fireEvent.change(aliceSelect, { target: { value: "admin" } });

    // Resolve patch() — updatingRole is cleared but roleRefetchAnchor is set
    await act(async () => {
      resolvePatch();
      await patchPromise;
    });

    // Simulate mid-refetch: same data array reference, only stale flag changes.
    // resource.data is still initialMembers so the anchor comparison holds.
    const staleResource = { ...resource, stale: true };
    mockUseResource.mockReturnValue(staleResource);
    act(() => {
      rerender(<Members />);
    });

    // Both selects must still be disabled — patch has settled but the fresh
    // member list hasn't arrived yet (anchor not yet cleared).
    const aliceSelectMid = screen.getByRole("combobox", {
      name: new RegExp(ALICE.pubkey.slice(0, 8), "i"),
    });
    expect(aliceSelectMid).toBeDisabled();

    const bobSelectMid = screen.getByRole("combobox", {
      name: new RegExp(BOB.pubkey.slice(0, 8), "i"),
    });
    expect(bobSelectMid).toBeDisabled();

    // Refetch completes — new array reference clears the anchor
    const freshMembers: RelayMember[] = [
      { ...ALICE, role: "admin" },
      BOB,
    ];
    const freshResource = makeResource(freshMembers);
    mockUseResource.mockReturnValue(freshResource);
    act(() => {
      rerender(<Members />);
    });

    // Anchor cleared → selects are now enabled
    const aliceSelectAfter = screen.getByRole("combobox", {
      name: new RegExp(ALICE.pubkey.slice(0, 8), "i"),
    });
    expect(aliceSelectAfter).not.toBeDisabled();
    expect(aliceSelectAfter).toHaveValue("admin");

    const bobSelectAfter = screen.getByRole("combobox", {
      name: new RegExp(BOB.pubkey.slice(0, 8), "i"),
    });
    expect(bobSelectAfter).not.toBeDisabled();
  });

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
