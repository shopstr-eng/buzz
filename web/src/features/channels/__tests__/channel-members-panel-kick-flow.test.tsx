/**
 * Regression tests for the kick *flow* in ChannelMembersPanel's MemberRow:
 *
 * - Clicking "Remove from channel" opens the inline confirmation WITHOUT
 *   calling kickMember yet.
 * - "Cancel" aborts and restores the normal row — kickMember never called.
 * - Only the confirm button invokes kickMember, with the right pubkey, and
 *   on success the row shows the optimistic "removing" state.
 * - A rejected kickMember surfaces the inline error and leaves the row intact.
 */

import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ChannelMember } from "../use-channel-members";

const OWNER = "aa".repeat(32);
const MEMBER = "cc".repeat(32);
const AGENT = "dd".repeat(32);

const members: ChannelMember[] = [
  { pubkey: OWNER, role: "owner", isAgent: false },
  { pubkey: MEMBER, role: "member", isAgent: false },
  { pubkey: AGENT, role: "member", isAgent: true },
];

// Controllable kickMember mock, reconfigured per test.
const kickMember = vi.fn<(pubkey: string) => Promise<void>>();

vi.mock("../use-channel-members", () => ({
  useChannelMembers: () => ({
    members,
    isLoading: false,
    kickMember,
    changeRole: vi.fn(),
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
  kickMember.mockReset();
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

/** Open the action menu on a member's row and click the kick entry. */
function startKick(pubkey: string, label = "Remove from channel") {
  const row = rowFor(pubkey);
  fireEvent.click(within(row).getByLabelText("Member actions"));
  fireEvent.click(within(row).getByText(label));
}

describe("ChannelMembersPanel kick flow", () => {
  it("menu kick opens inline confirmation without calling kickMember", () => {
    renderAsOwner();
    startKick(MEMBER);

    // Confirmation prompt visible with confirm + cancel buttons.
    const short = `${MEMBER.slice(0, 7)}…${MEMBER.slice(-4)}`;
    expect(screen.getByText(`Remove ${short}?`)).toBeInTheDocument();
    expect(screen.getByText("Cancel")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();

    // No relay call yet.
    expect(kickMember).not.toHaveBeenCalled();
  });

  it("Cancel aborts and restores the normal row without calling kickMember", () => {
    renderAsOwner();
    startKick(MEMBER);

    fireEvent.click(screen.getByText("Cancel"));

    // Confirmation gone, normal row (with action button) back.
    const short = `${MEMBER.slice(0, 7)}…${MEMBER.slice(-4)}`;
    expect(screen.queryByText(`Remove ${short}?`)).not.toBeInTheDocument();
    const row = rowFor(MEMBER);
    expect(within(row).getByLabelText("Member actions")).toBeInTheDocument();
    expect(kickMember).not.toHaveBeenCalled();
  });

  it("Confirm calls kickMember with the member's pubkey and shows the removing state", async () => {
    kickMember.mockResolvedValue(undefined);
    renderAsOwner();
    startKick(MEMBER);

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    expect(kickMember).toHaveBeenCalledTimes(1);
    expect(kickMember).toHaveBeenCalledWith(MEMBER);

    // Optimistic "removing" state: row dims, name goes italic, no action button.
    const short = `${MEMBER.slice(0, 7)}…${MEMBER.slice(-4)}`;
    await waitFor(() => {
      const label = screen.getByText(short);
      expect(label.className).toContain("italic");
    });
    expect(screen.queryByText(`Remove ${short}?`)).not.toBeInTheDocument();
  });

  it("a rejected kickMember surfaces the inline error and keeps the member row", async () => {
    kickMember.mockRejectedValue(new Error("relay said no"));
    renderAsOwner();
    startKick(MEMBER);

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() => {
      expect(screen.getByText("relay said no")).toBeInTheDocument();
    });
    expect(kickMember).toHaveBeenCalledWith(MEMBER);

    // Confirmation closed; normal row back (not the removing state).
    const short = `${MEMBER.slice(0, 7)}…${MEMBER.slice(-4)}`;
    expect(screen.queryByText(`Remove ${short}?`)).not.toBeInTheDocument();
    const row = rowFor(MEMBER);
    expect(within(row).getByLabelText("Member actions")).toBeInTheDocument();
  });

  it("non-Error rejection falls back to the generic error message", async () => {
    kickMember.mockRejectedValue("boom");
    renderAsOwner();
    startKick(MEMBER);

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() => {
      expect(screen.getByText("Failed to remove member.")).toBeInTheDocument();
    });
  });

  it("agents use Disconnect wording through the same confirm flow", () => {
    renderAsOwner();
    startKick(AGENT, "Disconnect agent");

    const short = `${AGENT.slice(0, 7)}…${AGENT.slice(-4)}`;
    expect(screen.getByText(`Disconnect ${short}?`)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeInTheDocument();
    expect(kickMember).not.toHaveBeenCalled();
  });
});
