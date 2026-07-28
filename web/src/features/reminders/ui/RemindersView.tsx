/**
 * Reminders panel: pending reminders sorted by due time, with done/cancel.
 */

import { Link } from "@tanstack/react-router";
import { AlarmClock, Check, Loader, X } from "lucide-react";
import { useReminders } from "../use-reminders";
import { relativeTime } from "@/shared/lib/relative-time";

export function RemindersView() {
  const { reminders, isLoading, supported, setStatus } = useReminders();
  const pending = reminders.filter((r) => r.status === "pending");
  const now = Date.now() / 1000;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-2 border-b border-black/10 px-4 py-3 dark:border-white/10">
        <AlarmClock className="h-4 w-4 text-black/40 dark:text-white/40" />
        <h1 className="text-sm font-semibold text-black dark:text-white">Reminders</h1>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {supported === false ? (
          <p className="pt-8 text-center text-xs text-black/35 dark:text-white/35">
            Reminders need an nsec login or a NIP-07 extension with NIP-44 support.
          </p>
        ) : isLoading && pending.length === 0 ? (
          <p className="flex items-center justify-center gap-2 pt-8 text-xs text-black/35 dark:text-white/35">
            <Loader className="h-3.5 w-3.5 animate-spin" /> Loading reminders…
          </p>
        ) : pending.length === 0 ? (
          <p className="pt-8 text-center text-xs text-black/35 dark:text-white/35">
            No pending reminders — use “Remind me” on any message.
          </p>
        ) : (
          <div className="space-y-1">
            {pending.map((r) => {
              const due = r.notBefore <= now;
              return (
                <div
                  key={r.dTag}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${
                    due
                      ? "border-violet-300 bg-violet-50 dark:border-violet-700 dark:bg-violet-900/20"
                      : "border-black/10 dark:border-white/10"
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    {r.target?.channelId ? (
                      <Link
                        to="/channels/$groupId"
                        params={{ groupId: r.target.channelId }}
                        className="block truncate text-xs font-medium text-black hover:underline dark:text-white"
                      >
                        {r.note || "Reminder"}
                      </Link>
                    ) : (
                      <p className="truncate text-xs font-medium text-black dark:text-white">
                        {r.note || "Reminder"}
                      </p>
                    )}
                    <p className={`text-[10px] ${due ? "font-medium text-violet-600 dark:text-violet-400" : "text-black/40 dark:text-white/40"}`}>
                      {due ? "Due now" : `in ${relativeTime(r.notBefore).replace(" ago", "")}`}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void setStatus(r, "done")}
                    title="Mark done"
                    aria-label="Mark done"
                    className="rounded p-1 text-black/30 hover:bg-emerald-50 hover:text-emerald-600 dark:text-white/30 dark:hover:bg-emerald-900/20 dark:hover:text-emerald-400"
                  >
                    <Check className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void setStatus(r, "cancelled")}
                    title="Cancel reminder"
                    aria-label="Cancel reminder"
                    className="rounded p-1 text-black/30 hover:bg-red-50 hover:text-red-600 dark:text-white/30 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
