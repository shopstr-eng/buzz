/**
 * Unified inbox construction — pure logic, ported from the desktop's new
 * home inbox (desktop/src/features/home/lib/inbox.ts, upstream merge).
 *
 * Semantics mirrored:
 * - conversationId: `project:<repoAddress>:<rootId>` for repo items,
 *   `dm:<channelId>` for DM channels, otherwise thread rootId ?? parentId ?? id.
 * - category priority: needs_action (0) > mention (1) > agent_activity (2) >
 *   activity (3) — the group's category is its highest-priority item's.
 * - unified sort: rows by sortAt desc, where reminder rows sort by their due
 *   time (notBefore) and inbox rows by latest activity.
 *
 * Delta vs desktop: no unread counts (web has no read-marker tracking), no
 * draft rows (web has no composer drafts).
 */

export type InboxCategory = "needs_action" | "mention" | "agent_activity" | "activity";

export const CATEGORY_PRIORITY: Record<InboxCategory, number> = {
  needs_action: 0,
  mention: 1,
  agent_activity: 2,
  activity: 3,
};

export const CATEGORY_LABEL: Record<InboxCategory | "reminder", string> = {
  needs_action: "Needs action",
  mention: "Mention",
  agent_activity: "Agent",
  activity: "Activity",
  reminder: "Reminder",
};

/** One classified event feeding the inbox. */
export interface InboxItem {
  id: string;
  kind: number;
  pubkey: string;
  content: string;
  createdAt: number;
  category: InboxCategory;
  /** h-tag channel id, when channel-scoped. */
  channelId?: string;
  channelType?: string;
  /** Thread root (e-tag with root marker, else first e-tag). */
  rootId?: string;
  /** Direct parent (e-tag with reply marker), for thread grouping fallback. */
  parentId?: string;
  /** a-tag repo coordinate (30617:<owner>:<d>) for project items. */
  repoAddress?: string;
}

/** Reminder shape needed by the row builder (structural subset of Reminder). */
export interface InboxReminder {
  dTag: string;
  status: "pending" | "done" | "cancelled";
  note: string;
  notBefore: number;
  createdAt: number;
  target?: { eventId?: string; channelId?: string; preview?: string };
}

export interface InboxRow {
  /** conversationId for inbox rows; `reminder:<dTag>` for reminders. */
  id: string;
  rowKind: "inbox" | "reminder";
  category: InboxCategory | "reminder";
  preview: string;
  authorPubkey?: string;
  channelId?: string;
  channelType?: string;
  /** Number of events folded into this row (inbox rows only). */
  itemCount: number;
  /** latestActivityAt for inbox rows; due time (notBefore) for reminders. */
  sortAt: number;
}

/**
 * Stable conversation identity, mirroring desktop's getInboxConversationId:
 * project items group under `project:<repo>:<root>`, DMs under `dm:<channel>`,
 * everything else under its thread root (falling back to parent, then self).
 */
export function conversationIdOf(item: InboxItem): string {
  if (item.repoAddress && item.rootId) {
    return `project:${item.repoAddress}:${item.rootId}`;
  }
  if (item.channelType === "dm" && item.channelId) {
    return `dm:${item.channelId}`;
  }
  return item.rootId ?? item.parentId ?? item.id;
}

/**
 * Fold inbox items + pending reminders into unified rows sorted by sortAt desc.
 * Each inbox row's category is the highest-priority category among its items;
 * its preview/author come from the latest item.
 */
export function buildInboxRows(
  items: InboxItem[],
  reminders: InboxReminder[],
): InboxRow[] {
  const groups = new Map<string, InboxItem[]>();
  for (const item of items) {
    const key = conversationIdOf(item);
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }

  const rows: InboxRow[] = [];
  for (const [id, groupItems] of groups) {
    groupItems.sort((a, b) => a.createdAt - b.createdAt);
    const latest = groupItems[groupItems.length - 1];
    const category = groupItems.reduce(
      (best, it) =>
        CATEGORY_PRIORITY[it.category] < CATEGORY_PRIORITY[best] ? it.category : best,
      groupItems[0].category,
    );
    rows.push({
      id,
      rowKind: "inbox",
      category,
      preview: latest.content,
      authorPubkey: latest.pubkey,
      channelId: latest.channelId,
      channelType: latest.channelType,
      itemCount: groupItems.length,
      sortAt: latest.createdAt,
    });
  }

  for (const reminder of reminders) {
    if (reminder.status !== "pending") continue;
    rows.push({
      id: `reminder:${reminder.dTag}`,
      rowKind: "reminder",
      category: "reminder",
      preview: reminder.note || reminder.target?.preview || "Reminder",
      channelId: reminder.target?.channelId,
      itemCount: 1,
      sortAt: reminder.notBefore,
    });
  }

  return rows.sort((a, b) => b.sortAt - a.sortAt);
}
