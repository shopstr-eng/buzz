/**
 * UI-policy regression tests for ChannelMembersPanel's direct member-add form
 * (desktop role-hierarchy parity):
 *
 * - The "Add member" form entry point is visible only to owners and admins.
 * - Within the form's role select, the "Admin" option is owner-only —
 *   admins may add members but never other admins.
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ChannelMember } from "../use-channel-members";

const OWNER = "aa".repeat(32);
const ADMIN = "bb".repeat(32);
const MEMBER = "cc".repeat(32);
const OUTSIDER = "dd".repeat(32);

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

function renderAs(myPubkey?: string) {
  return render(
    <ChannelMembersPanel groupId="grp" myPubkey={myPubkey} onClose={() => {}} />,
  );
}

describe("ChannelMembersPanel add-member gating", () => {
  it("shows the Add member entry point to the owner", () => {
    renderAs(OWNER);
    expect(screen.getByText("Add member")).toBeInTheDocument();
  });

  it("shows the Add member entry point to admins", () => {
    renderAs(ADMIN);
    expect(screen.getByText("Add member")).toBeInTheDocument();
  });

  it("hides the Add member entry point from regular members", () => {
    renderAs(MEMBER);
    expect(screen.queryByText("Add member")).not.toBeInTheDocument();
  });

  it("hides the Add member entry point from non-members and signed-out users", () => {
    renderAs(OUTSIDER);
    expect(screen.queryByText("Add member")).not.toBeInTheDocument();

    renderAs(undefined);
    expect(screen.queryByText("Add member")).not.toBeInTheDocument();
  });
});

describe("ChannelMembersPanel add-member role hierarchy", () => {
  it("offers the Admin role option to the owner", () => {
    renderAs(OWNER);
    fireEvent.click(screen.getByText("Add member"));
    const options = screen
      .getAllByRole("option")
      .map((o) => (o as HTMLOptionElement).value);
    expect(options).toContain("member");
    expect(options).toContain("admin");
  });

  it("does NOT offer the Admin role option to admins", () => {
    renderAs(ADMIN);
    fireEvent.click(screen.getByText("Add member"));
    const options = screen
      .getAllByRole("option")
      .map((o) => (o as HTMLOptionElement).value);
    expect(options).toContain("member");
    expect(options).not.toContain("admin");
  });
});
