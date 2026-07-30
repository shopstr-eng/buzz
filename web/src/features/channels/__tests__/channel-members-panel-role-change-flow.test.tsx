/**
 * Regression tests for the role-change *flow* in ChannelMembersPanel's
 * MemberRow ("Make admin" / "Remove admin" menu entries):
 *
 * - "Make admin" calls changeRole(pubkey, "admin").
 * - "Remove admin" calls changeRole(pubkey, "member").
 * - The row shows the acting spinner while the changeRole promise is pending
 *   (the action menu button is hidden meanwhile).
 * - A rejected changeRole surfaces the inline error on the row.
 */

import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ChannelMember } from "../use-channel-members";

const OWNER = "aa".repeat(32);
const ADMIN = "bb".repeat(32);
const MEMBER = "cc".repeat(32);

const members: ChannelMember[] = [
  { pubkey: OWNER, role: "owner", isAgent: false },
  { pubkey: ADMIN, role: "admin", isAgent: false },
  { pubkey: MEMBER, role: "member", isAgent: false },
];

// Controllable changeRole mock, reconfigured per test.
const changeRole =
  vi.fn<(pubkey: string, role: "admin" | "member") => Promise<void>>();

vi.mock("../use-channel-members", () => ({
  useChannelMembers: () => ({
    members,
    isLoading: false,
    kickMember: vi.fn(),
    changeRole,
    addMember: vi.fn(),
  }),
}));
vi.mock("../use-presence", () => ({
  usePresenceMap: () => new Map(),
}));
vi.mock("@/shared/hooks/use-profiles", () => ({
  useProfiles: () => new Map(),
}));
vi.mock("../ui/ConnectAgentDialog", () => ({
  ConnectAgentDialog: () => null,
}));

import { ChannelMembersPanel } from "../ui/ChannelMembersPanel";

beforeEach(() => {
  changeRole.mockReset();
  // Panel probes /assets/relay-info.json for AI-provider status; stub it out.
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve(null) }),
  );
});

function renderAsOwner() {
  return render(
    <ChannelMembersPanel groupId="grp" myPubkey={OWNER} onClose={() => {}} />,
  );
}

/** Find the MemberRow container for a given member pubkey. */
function rowFor(pubkey: string): HTMLElement {
  const el = screen.getAllByTitle(pubkey)[0].closest(".group");
  if (!el) throw new Error(`row not found for ${pubkey}`);
  return el as HTMLElement;
}

/** Open the action menu on a member's row and click the given entry. */
function clickMenuEntry(pubkey: string, label: string) {
  const row = rowFor(pubkey);
  fireEvent.click(within(row).getByLabelText("Member actions"));
  fireEvent.click(within(row).getByText(label));
}

describe("ChannelMembersPanel role-change flow", () => {
  it("'Make admin' calls changeRole with the member's pubkey and 'admin'", async () => {
    changeRole.mockResolvedValue(undefined);
    renderAsOwner();

    clickMenuEntry(MEMBER, "Make admin");

    expect(changeRole).toHaveBeenCalledTimes(1);
    expect(changeRole).toHaveBeenCalledWith(MEMBER, "admin");

    // Once the promise settles, the row returns to normal (no spinner, no error).
    await waitFor(() => {
      const row = rowFor(MEMBER);
      expect(within(row).getByLabelText("Member actions")).toBeInTheDocument();
    });
  });

  it("'Remove admin' calls changeRole with the admin's pubkey and 'member'", async () => {
    changeRole.mockResolvedValue(undefined);
    renderAsOwner();

    clickMenuEntry(ADMIN, "Remove admin");

    expect(changeRole).toHaveBeenCalledTimes(1);
    expect(changeRole).toHaveBeenCalledWith(ADMIN, "member");

    await waitFor(() => {
      const row = rowFor(ADMIN);
      expect(within(row).getByLabelText("Member actions")).toBeInTheDocument();
    });
  });

  it("shows the acting spinner while the changeRole promise is pending", async () => {
    let resolveChange!: () => void;
    changeRole.mockImplementation(
      () => new Promise<void>((resolve) => { resolveChange = resolve; }),
    );
    renderAsOwner();

    clickMenuEntry(MEMBER, "Make admin");

    // Pending: spinner visible on the row, action-menu button hidden.
    const row = rowFor(MEMBER);
    await waitFor(() => {
      expect(row.querySelector(".animate-spin")).toBeInTheDocument();
    });
    expect(within(row).queryByLabelText("Member actions")).not.toBeInTheDocument();

    // Settle the promise — spinner goes away, action button returns.
    resolveChange();
    await waitFor(() => {
      expect(row.querySelector(".animate-spin")).not.toBeInTheDocument();
    });
    expect(within(row).getByLabelText("Member actions")).toBeInTheDocument();
  });

  it("a rejected changeRole surfaces the inline error on the row", async () => {
    changeRole.mockRejectedValue(new Error("relay said no"));
    renderAsOwner();

    clickMenuEntry(MEMBER, "Make admin");

    await waitFor(() => {
      expect(screen.getByText("relay said no")).toBeInTheDocument();
    });
    expect(changeRole).toHaveBeenCalledWith(MEMBER, "admin");

    // Row stays intact and actionable after the failure.
    const row = rowFor(MEMBER);
    expect(within(row).getByLabelText("Member actions")).toBeInTheDocument();
  });

  it("non-Error rejection falls back to the generic error message", async () => {
    changeRole.mockRejectedValue("boom");
    renderAsOwner();

    clickMenuEntry(ADMIN, "Remove admin");

    await waitFor(() => {
      expect(screen.getByText("Failed.")).toBeInTheDocument();
    });
    expect(changeRole).toHaveBeenCalledWith(ADMIN, "member");
  });
});
