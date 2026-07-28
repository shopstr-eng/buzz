import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import type { InboxRow } from "../lib/inbox";

const rows: InboxRow[] = [
  {
    id: "reminder:bare",
    rowKind: "reminder",
    category: "reminder",
    preview: "Follow up on this later",
    itemCount: 1,
    sortAt: 1000,
  },
  {
    id: "chan:mention",
    rowKind: "inbox",
    category: "mention",
    preview: "hey you",
    authorPubkey: "aa".repeat(32),
    channelId: "chan-1",
    channelType: "channel",
    itemCount: 1,
    sortAt: 900,
  },
];

vi.mock("../use-home-inbox", () => ({
  useHomeInbox: () => ({ rows, isLoading: false }),
}));
vi.mock("../../channels/use-channels", () => ({
  useChannels: () => ({ channels: [] }),
}));
vi.mock("@/shared/hooks/use-profiles", () => ({
  useProfiles: () => new Map(),
}));
// TanStack Link needs a router; stand it in with an anchor that exposes `to`.
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, ...rest }: { to: string; children: React.ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

import { InboxView } from "../ui/InboxView";

describe("InboxView row navigation", () => {
  it("reminder rows without a channelId link to the reminders screen", () => {
    render(<InboxView />);
    const reminder = screen.getByText("Follow up on this later").closest("a");
    expect(reminder).not.toBeNull();
    expect(reminder?.getAttribute("href")).toBe("/channels/reminders");
  });

  it("inbox rows with a channelId link to that channel", () => {
    render(<InboxView />);
    const mention = screen.getByText("hey you").closest("a");
    expect(mention).not.toBeNull();
    expect(mention?.getAttribute("href")).toBe("/channels/$groupId");
  });
});
