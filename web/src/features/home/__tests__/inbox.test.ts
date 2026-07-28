/**
 * Tests for unified inbox construction (desktop parity): conversation
 * grouping, category priority folding, approval resolution, and unified
 * sortAt ordering with reminder rows.
 */

import { describe, expect, it } from "vitest";
import {
  buildInboxRows,
  conversationIdOf,
  CATEGORY_PRIORITY,
  type InboxItem,
  type InboxReminder,
} from "../lib/inbox";

const ALICE = "a".repeat(64);

function item(over: Partial<InboxItem>): InboxItem {
  return {
    id: "ev1",
    kind: 9,
    pubkey: ALICE,
    content: "hello",
    createdAt: 100,
    category: "mention",
    channelId: "chan-1",
    ...over,
  };
}

describe("conversationIdOf", () => {
  it("groups project items under project:<repo>:<root>", () => {
    expect(
      conversationIdOf(item({ repoAddress: "30617:owner:repo", rootId: "issue-1", id: "issue-1" })),
    ).toBe("project:30617:owner:repo:issue-1");
  });

  it("groups DM channel traffic under dm:<channel>", () => {
    expect(conversationIdOf(item({ channelType: "dm", channelId: "dm-9" }))).toBe("dm:dm-9");
  });

  it("groups thread replies under their root, falling back to parent then self", () => {
    expect(conversationIdOf(item({ rootId: "root-1" }))).toBe("root-1");
    expect(conversationIdOf(item({ parentId: "parent-1" }))).toBe("parent-1");
    expect(conversationIdOf(item({ id: "self-1" }))).toBe("self-1");
  });
});

describe("buildInboxRows", () => {
  it("folds same-conversation items into one row with the highest-priority category", () => {
    const rows = buildInboxRows(
      [
        item({ id: "a1", rootId: "r1", category: "activity", createdAt: 100 }),
        item({ id: "a2", rootId: "r1", category: "needs_action", createdAt: 200, content: "approve?" }),
      ],
      [],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].category).toBe("needs_action");
    expect(rows[0].itemCount).toBe(2);
    expect(rows[0].sortAt).toBe(200);
    expect(rows[0].preview).toBe("approve?");
  });

  it("mixes pending reminders by due time and skips non-pending ones", () => {
    const reminders: InboxReminder[] = [
      { dTag: "d1", status: "pending", note: "standup", notBefore: 150, createdAt: 90 },
      { dTag: "d2", status: "done", note: "old", notBefore: 500, createdAt: 80 },
    ];
    const rows = buildInboxRows([item({ createdAt: 100 })], reminders);
    expect(rows.map((r) => r.id)).toEqual(["reminder:d1", "ev1"]);
    expect(rows[0].sortAt).toBe(150);
  });

  it("sorts all rows by sortAt desc regardless of category", () => {
    const rows = buildInboxRows(
      [
        item({ id: "m1", category: "mention", createdAt: 100 }),
        item({ id: "n1", rootId: "other", category: "needs_action", createdAt: 50 }),
      ],
      [],
    );
    expect(rows[0].id).toBe("m1");
    expect(rows[1].id).toBe("other");
  });

  it("category priority order matches mobile: needs_action > mention > agent > activity", () => {
    expect(CATEGORY_PRIORITY.needs_action).toBeLessThan(CATEGORY_PRIORITY.mention);
    expect(CATEGORY_PRIORITY.mention).toBeLessThan(CATEGORY_PRIORITY.agent_activity);
    expect(CATEGORY_PRIORITY.agent_activity).toBeLessThan(CATEGORY_PRIORITY.activity);
  });

  it("groups untagged DM-feed events under dm:<channel> as activity rows", () => {
    // DM-feed events carry no p-tags and no thread refs — they must not
    // inflate the mention category.
    const rows = buildInboxRows(
      [
        item({ id: "dm1", channelType: "dm", channelId: "dm-5", category: "activity", createdAt: 100 }),
        item({ id: "dm2", channelType: "dm", channelId: "dm-5", category: "activity", createdAt: 200 }),
      ],
      [],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("dm:dm-5");
    expect(rows[0].category).toBe("activity");
    expect(rows[0].itemCount).toBe(2);
  });
});
