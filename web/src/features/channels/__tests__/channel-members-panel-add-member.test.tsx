/**
 * Permission tests for the ChannelMembersPanel footer "Add member" flow
 * (canAddMember + owner-only "Admin" role option in the add-member form):
 *
 * - Plain member: no "Add member" button at all.
 * - Admin: sees the button, but the role select offers only "Member".
 * - Owner: sees the button, and the role select offers "Member" and "Admin".
 */

import { render, screen, fireEvent, within } from "@testing-library/react";
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

vi.mock("../use-channel-members", () => ({
  useChannelMembers: () => ({
    members,
    isLoading: false,
    kickMember: vi.fn(),
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
  // Panel probes /assets/relay-info.json for AI-provider status; stub it out.
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve(null) }),
  );
});

function renderAs(myPubkey: string) {
  return render(
    <ChannelMembersPanel groupId="grp" myPubkey={myPubkey} onClose={() => {}} />,
  );
}

/** Open the add-member form and return the role <select>. */
function openAddMemberForm(): HTMLSelectElement {
  fireEvent.click(screen.getByText("Add member"));
  return screen.getByRole("combobox") as HTMLSelectElement;
}

describe("ChannelMembersPanel add-member permissions", () => {
  it("plain member sees no 'Add member' button", () => {
    renderAs(MEMBER);

    expect(screen.queryByText("Add member")).not.toBeInTheDocument();
  });

  it("admin sees the button, but the role select offers only 'Member'", () => {
    renderAs(ADMIN);

    const select = openAddMemberForm();
    const options = within(select).getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["Member"]);
    expect(within(select).queryByRole("option", { name: "Admin" })).not.toBeInTheDocument();
  });

  it("owner's role select offers both 'Member' and 'Admin'", () => {
    renderAs(OWNER);

    const select = openAddMemberForm();
    const options = within(select).getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["Member", "Admin"]);
  });
});
