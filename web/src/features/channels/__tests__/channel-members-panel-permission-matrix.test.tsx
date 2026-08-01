/**
 * Permission-matrix regression tests for ChannelMembersPanel:
 * which rows expose the "Member actions" button and which menu entries
 * appear, depending on the signed-in user's role (canAct / canChangeRole /
 * canKick logic in MemberRow / ActionMenu).
 *
 * - Admin: may act only on plain members; menu shows only the kick entry
 *   (no "Make admin" / "Remove admin"); no actions on owner, other admins,
 *   or self.
 * - Member: sees no action button on any row.
 * - Self: never sees an action button on their own row, regardless of role.
 * - Owner: sees role-change + kick entries on member and admin rows, but no
 *   button on their own (owner) row.
 */

import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ChannelMember } from "../use-channel-members";

const OWNER = "aa".repeat(32);
const ADMIN = "bb".repeat(32);
const ADMIN2 = "dd".repeat(32);
const MEMBER = "cc".repeat(32);

const members: ChannelMember[] = [
  { pubkey: OWNER, role: "owner", isAgent: false },
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

function renderAs(myPubkey: string) {
  return render(
    <ChannelMembersPanel groupId="grp" myPubkey={myPubkey} onClose={() => {}} />,
  );
}

/** Find the MemberRow container for a given member pubkey. */
function rowFor(pubkey: string): HTMLElement {
  const el = screen.getAllByTitle(pubkey)[0].closest(".group");
  if (!el) throw new Error(`row not found for ${pubkey}`);
  return el as HTMLElement;
}

function actionsButton(pubkey: string) {
  return within(rowFor(pubkey)).queryByLabelText("Member actions");
}

/** Open the action menu on a row and return the row element. */
function openMenu(pubkey: string): HTMLElement {
  const row = rowFor(pubkey);
  fireEvent.click(within(row).getByLabelText("Member actions"));
  return row;
}

describe("ChannelMembersPanel permission matrix", () => {
  describe("signed in as admin", () => {
    it("shows the actions button only on plain-member rows", () => {
      renderAs(ADMIN);

      expect(actionsButton(MEMBER)).toBeInTheDocument();
      expect(actionsButton(OWNER)).not.toBeInTheDocument(); // cannot act on owner
      expect(actionsButton(ADMIN2)).not.toBeInTheDocument(); // cannot act on other admins
      expect(actionsButton(ADMIN)).not.toBeInTheDocument(); // cannot act on self
    });

    it("member-row menu has kick but no role-change entries", () => {
      renderAs(ADMIN);

      const row = openMenu(MEMBER);
      expect(within(row).getByText("Remove from channel")).toBeInTheDocument();
      expect(within(row).queryByText("Make admin")).not.toBeInTheDocument();
      expect(within(row).queryByText("Remove admin")).not.toBeInTheDocument();
    });
  });

  describe("signed in as plain member", () => {
    it("shows no actions button on any row", () => {
      renderAs(MEMBER);

      expect(screen.queryByLabelText("Member actions")).not.toBeInTheDocument();
    });
  });

  describe("signed in as owner", () => {
    it("shows the actions button on admin and member rows but not on own row", () => {
      renderAs(OWNER);

      expect(actionsButton(ADMIN)).toBeInTheDocument();
      expect(actionsButton(ADMIN2)).toBeInTheDocument();
      expect(actionsButton(MEMBER)).toBeInTheDocument();
      expect(actionsButton(OWNER)).not.toBeInTheDocument(); // self / owner row
    });

    it("member-row menu has 'Make admin' and kick", () => {
      renderAs(OWNER);

      const row = openMenu(MEMBER);
      expect(within(row).getByText("Make admin")).toBeInTheDocument();
      expect(within(row).getByText("Remove from channel")).toBeInTheDocument();
      expect(within(row).queryByText("Remove admin")).not.toBeInTheDocument();
    });

    it("admin-row menu has 'Remove admin' and kick", () => {
      renderAs(OWNER);

      const row = openMenu(ADMIN);
      expect(within(row).getByText("Remove admin")).toBeInTheDocument();
      expect(within(row).getByText("Remove from channel")).toBeInTheDocument();
      expect(within(row).queryByText("Make admin")).not.toBeInTheDocument();
    });
  });
});
