/**
 * UI-policy regression tests for ChannelMembersPanel's direct member-add form
 * (desktop role-hierarchy parity):
 *
 * - The "Add member" form entry point is visible only to owners and admins.
 * - Within the form's role select, the "Admin" option is owner-only —
 *   admins may add members but never other admins.
 */

import { render, screen, fireEvent, within, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ChannelMember } from "../use-channel-members";

const OWNER = "aa".repeat(32);
const ADMIN = "bb".repeat(32);
const MEMBER = "cc".repeat(32);
const OUTSIDER = "dd".repeat(32);
const OWNER2 = "ee".repeat(32);
const ADMIN2 = "ff".repeat(32);

const members: ChannelMember[] = [
  { pubkey: OWNER, role: "owner", isAgent: false },
  { pubkey: OWNER2, role: "owner", isAgent: false },
  { pubkey: ADMIN, role: "admin", isAgent: false },
  { pubkey: ADMIN2, role: "admin", isAgent: false },
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

// ── Per-member action menu (kick / role change) ──────────────────────────────

/** Find the MemberRow container for a given member pubkey. */
function rowFor(pubkey: string): HTMLElement {
  // Both the avatar fallback and the name label carry title={pubkey}; either
  // is inside the row container (class "group").
  const el = screen.getAllByTitle(pubkey)[0].closest(".group");
  if (!el) throw new Error(`row not found for ${pubkey}`);
  return el as HTMLElement;
}

function actionButtonIn(row: HTMLElement): HTMLElement | null {
  return within(row).queryByLabelText("Member actions");
}

function openMenu(pubkey: string): HTMLElement {
  const row = rowFor(pubkey);
  const btn = actionButtonIn(row);
  if (!btn) throw new Error(`no action button in row for ${pubkey}`);
  fireEvent.click(btn);
  return row;
}

describe("ChannelMembersPanel action-menu visibility (canAct)", () => {
  it("owner: sees actions on admins and members, but not on other owners or self", () => {
    renderAs(OWNER);
    expect(actionButtonIn(rowFor(ADMIN))).toBeInTheDocument();
    expect(actionButtonIn(rowFor(MEMBER))).toBeInTheDocument();
    expect(actionButtonIn(rowFor(OWNER2))).not.toBeInTheDocument();
    expect(actionButtonIn(rowFor(OWNER))).not.toBeInTheDocument(); // self
  });

  it("admin: sees actions only on plain members — never on owners, other admins, or self", () => {
    renderAs(ADMIN);
    expect(actionButtonIn(rowFor(MEMBER))).toBeInTheDocument();
    expect(actionButtonIn(rowFor(OWNER))).not.toBeInTheDocument();
    expect(actionButtonIn(rowFor(ADMIN2))).not.toBeInTheDocument();
    expect(actionButtonIn(rowFor(ADMIN))).not.toBeInTheDocument(); // self
  });

  it("regular member: sees no action buttons on any row", () => {
    renderAs(MEMBER);
    for (const pk of [OWNER, OWNER2, ADMIN, ADMIN2, MEMBER]) {
      expect(actionButtonIn(rowFor(pk))).not.toBeInTheDocument();
    }
  });

  it("non-members and signed-out users see no action buttons", () => {
    renderAs(OUTSIDER);
    for (const pk of [OWNER, ADMIN, MEMBER]) {
      expect(actionButtonIn(rowFor(pk))).not.toBeInTheDocument();
    }
    cleanup();
    renderAs(undefined);
    for (const pk of [OWNER, ADMIN, MEMBER]) {
      expect(actionButtonIn(rowFor(pk))).not.toBeInTheDocument();
    }
  });
});

describe("ChannelMembersPanel action-menu options", () => {
  it("owner on a plain member: Make admin + Remove from channel", () => {
    renderAs(OWNER);
    const row = openMenu(MEMBER);
    expect(within(row).getByText("Make admin")).toBeInTheDocument();
    expect(within(row).queryByText("Remove admin")).not.toBeInTheDocument();
    expect(within(row).getByText("Remove from channel")).toBeInTheDocument();
  });

  it("owner on an admin: Remove admin + Remove from channel (no Make admin)", () => {
    renderAs(OWNER);
    const row = openMenu(ADMIN);
    expect(within(row).getByText("Remove admin")).toBeInTheDocument();
    expect(within(row).queryByText("Make admin")).not.toBeInTheDocument();
    expect(within(row).getByText("Remove from channel")).toBeInTheDocument();
  });

  it("admin on a plain member: kick only — no role-change options", () => {
    renderAs(ADMIN);
    const row = openMenu(MEMBER);
    expect(within(row).getByText("Remove from channel")).toBeInTheDocument();
    expect(within(row).queryByText("Make admin")).not.toBeInTheDocument();
    expect(within(row).queryByText("Remove admin")).not.toBeInTheDocument();
  });
});
