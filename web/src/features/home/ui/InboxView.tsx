/**
 * Unified inbox view (desktop/mobile parity): one prioritized list folding
 * mentions, thread replies, approvals, agent activity, and pending reminders.
 */

import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Bell, Loader } from "lucide-react";
import { useHomeInbox } from "../use-home-inbox";
import { useChannels } from "../../channels/use-channels";
import { useProfiles } from "@/shared/hooks/use-profiles";
import { relativeTime } from "@/shared/lib/relative-time";
import { CATEGORY_LABEL, type InboxRow } from "../lib/inbox";

type Filter = "all" | "needs_action" | "mention" | "agent_activity" | "activity" | "reminder";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "needs_action", label: "Needs action" },
  { value: "mention", label: "Mentions" },
  { value: "agent_activity", label: "Agents" },
  { value: "activity", label: "Activity" },
  { value: "reminder", label: "Reminders" },
];

const BADGE_CLS: Record<string, string> = {
  needs_action: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  mention: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  agent_activity: "bg-purple-500/15 text-purple-600 dark:text-purple-400",
  activity: "bg-black/8 text-black/50 dark:bg-white/10 dark:text-white/50",
  reminder: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
};

export function InboxView() {
  const { rows, isLoading } = useHomeInbox();
  const { channels } = useChannels();
  const [filter, setFilter] = useState<Filter>("all");

  const channelNames = useMemo(
    () => new Map(channels.map((c) => [c.groupId, c.name])),
    [channels],
  );
  const authorPubkeys = useMemo(
    () => [...new Set(rows.map((r) => r.authorPubkey).filter((p): p is string => !!p))],
    [rows],
  );
  const profiles = useProfiles(authorPubkeys);

  const visible = filter === "all" ? rows : rows.filter((r) => r.category === filter);

  const rowBody = (row: InboxRow) => (
    <>
      <div className="flex items-baseline gap-2">
        <span
          className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${BADGE_CLS[row.category]}`}
        >
          {CATEGORY_LABEL[row.category]}
        </span>
        {row.authorPubkey && (
          <span className="truncate text-xs font-semibold text-black dark:text-white">
            {profiles.get(row.authorPubkey)?.name ??
              `${row.authorPubkey.slice(0, 4)}…${row.authorPubkey.slice(-4)}`}
          </span>
        )}
        {row.itemCount > 1 && (
          <span className="shrink-0 text-[10px] text-black/35 dark:text-white/35">
            {row.itemCount} messages
          </span>
        )}
        <span className="ml-auto shrink-0 text-[10px] text-black/35 dark:text-white/35">
          {row.rowKind === "reminder" ? `due ${relativeTime(row.sortAt)}` : relativeTime(row.sortAt)}
        </span>
      </div>
      <p className="mt-0.5 line-clamp-2 text-xs text-black/70 dark:text-white/70">
        {row.preview}
      </p>
      {row.channelId && (
        <p className="mt-0.5 truncate text-[10px] text-black/35 dark:text-white/35">
          in {channelNames.get(row.channelId) ?? row.channelId}
        </p>
      )}
    </>
  );

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-1">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setFilter(f.value)}
            className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
              filter === f.value
                ? "bg-black/10 text-black dark:bg-white/15 dark:text-white"
                : "text-black/45 hover:bg-black/5 hover:text-black dark:text-white/45 dark:hover:bg-white/5 dark:hover:text-white"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {isLoading && rows.length === 0 ? (
        <p className="flex items-center justify-center gap-2 pt-8 text-xs text-black/35 dark:text-white/35">
          <Loader className="h-3.5 w-3.5 animate-spin" /> Loading your inbox…
        </p>
      ) : visible.length === 0 ? (
        <p className="pt-8 text-center text-xs text-black/35 dark:text-white/35">
          {filter === "all"
            ? "Your inbox is empty — mentions, replies, approvals, agent activity, and reminders land here."
            : `Nothing under “${FILTERS.find((f) => f.value === filter)?.label}” right now.`}
        </p>
      ) : (
        <div className="space-y-0.5">
          {visible.map((row) =>
            row.channelId ? (
              <Link
                key={row.id}
                to="/channels/$groupId"
                params={{ groupId: row.channelId }}
                className="block rounded-lg px-3 py-2 hover:bg-black/5 dark:hover:bg-white/5"
              >
                {rowBody(row)}
              </Link>
            ) : (
              <div key={row.id} className="rounded-lg px-3 py-2">
                <div className="flex items-start gap-1.5">
                  {row.rowKind === "reminder" && (
                    <Bell className="mt-0.5 h-3 w-3 shrink-0 text-emerald-500" />
                  )}
                  <div className="min-w-0 flex-1">{rowBody(row)}</div>
                </div>
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}
