/**
 * "Remind me" dialog: preset times for a reminder anchored to a message.
 */

import { X } from "lucide-react";
import type { ChatMessage } from "../../channels/types";
import type { ReminderTarget } from "../use-reminders";

interface Props {
  message: ChatMessage;
  groupId: string;
  onSave: (note: string, target: ReminderTarget, notBefore: number) => Promise<void>;
  onClose: () => void;
}

function presets(): { label: string; at: () => number }[] {
  return [
    { label: "In 1 hour", at: () => Date.now() / 1000 + 3600 },
    { label: "In 3 hours", at: () => Date.now() / 1000 + 3 * 3600 },
    {
      label: "Tomorrow morning",
      at: () => {
        const d = new Date();
        d.setDate(d.getDate() + 1);
        d.setHours(9, 0, 0, 0);
        return d.getTime() / 1000;
      },
    },
    { label: "Next week", at: () => Date.now() / 1000 + 7 * 86400 },
  ];
}

export function RemindMeDialog({ message, groupId, onSave, onClose }: Props) {
  async function pick(at: () => number) {
    await onSave(
      message.content.slice(0, 80),
      {
        eventId: message.id,
        channelId: groupId,
        preview: message.content.slice(0, 80),
        authorPubkey: message.pubkey,
      },
      at(),
    );
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onMouseDown={onClose}>
      <div
        className="w-72 rounded-xl border border-black/10 bg-white p-4 shadow-xl dark:border-white/10 dark:bg-[#1E1E1E]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-black dark:text-white">Remind me</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-black/30 hover:text-black/60 dark:text-white/30 dark:hover:text-white/60">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mb-3 line-clamp-2 text-xs text-black/50 dark:text-white/50">
          {message.content}
        </p>
        <div className="space-y-1">
          {presets().map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => void pick(p.at)}
              className="w-full rounded-lg border border-black/10 px-3 py-2 text-left text-xs text-black/80 hover:bg-black/5 dark:border-white/10 dark:text-white/80 dark:hover:bg-white/10"
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
