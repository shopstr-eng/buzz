/**
 * Moderation dialogs: report a message (all members) and time out / ban a
 * member (moderators only).
 */

import { useState } from "react";
import { X } from "lucide-react";
import {
  REPORT_TYPES,
  TIMEOUT_PRESETS,
  type ReportType,
} from "../use-moderation";
import type { ChatMessage } from "../../channels/types";

function DialogShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onMouseDown={onClose}>
      <div
        className="w-80 rounded-xl border border-black/10 bg-white p-4 shadow-xl dark:border-white/10 dark:bg-[#1E1E1E]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-black dark:text-white">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-black/30 hover:text-black/60 dark:text-white/30 dark:hover:text-white/60">
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Report a message to the channel moderators (kind 1984). */
export function ReportDialog({
  message,
  onSubmit,
  onClose,
}: {
  message: ChatMessage;
  onSubmit: (reportType: ReportType, note?: string) => Promise<void>;
  onClose: () => void;
}) {
  const [reportType, setReportType] = useState<ReportType>("spam");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (sending) return;
    setSending(true);
    setError(null);
    try {
      await onSubmit(reportType, note);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit the report.");
    } finally {
      setSending(false);
    }
  }

  return (
    <DialogShell title="Report message" onClose={onClose}>
      <p className="mb-3 line-clamp-2 rounded-lg bg-black/5 px-2 py-1.5 text-xs text-black/60 dark:bg-white/5 dark:text-white/60">
        {message.content}
      </p>
      <label className="mb-1 block text-xs font-medium text-black/70 dark:text-white/70">
        Reason
      </label>
      <select
        value={reportType}
        onChange={(e) => setReportType(e.target.value as ReportType)}
        className="mb-3 w-full rounded-lg border border-black/15 bg-transparent px-2 py-1.5 text-xs text-black focus:outline-none dark:border-white/15 dark:bg-[#1E1E1E] dark:text-white"
      >
        {REPORT_TYPES.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </select>
      <label className="mb-1 block text-xs font-medium text-black/70 dark:text-white/70">
        Note (optional)
      </label>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        maxLength={500}
        placeholder="Anything the moderators should know…"
        className="mb-3 w-full resize-none rounded-lg border border-black/15 bg-transparent px-2 py-1.5 text-xs text-black placeholder:text-black/35 focus:outline-none dark:border-white/15 dark:text-white dark:placeholder:text-white/35"
      />
      {error && <p className="mb-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-xs text-black/60 hover:bg-black/5 dark:text-white/60 dark:hover:bg-white/10">
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={sending}
          className="rounded-lg bg-black px-3 py-1.5 text-xs font-medium text-white hover:opacity-80 disabled:opacity-40 dark:bg-white dark:text-black"
        >
          {sending ? "Reporting…" : "Submit report"}
        </button>
      </div>
    </DialogShell>
  );
}

/** Time out a member (kind 9042) — duration presets + optional reason. */
export function TimeoutDialog({
  memberName,
  onSubmit,
  onClose,
}: {
  memberName: string;
  onSubmit: (seconds: number, reason?: string) => Promise<void>;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pick(seconds: number) {
    if (sending) return;
    setSending(true);
    setError(null);
    try {
      await onSubmit(seconds, reason);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to apply the timeout.");
    } finally {
      setSending(false);
    }
  }

  return (
    <DialogShell title={`Time out ${memberName}`} onClose={onClose}>
      <p className="mb-2 text-xs text-black/50 dark:text-white/50">
        They won’t be able to post until the timeout expires.
      </p>
      <input
        type="text"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason (optional)"
        maxLength={200}
        className="mb-3 w-full rounded-lg border border-black/15 bg-transparent px-2 py-1.5 text-xs text-black placeholder:text-black/35 focus:outline-none dark:border-white/15 dark:text-white dark:placeholder:text-white/35"
      />
      <div className="space-y-1">
        {TIMEOUT_PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => void pick(p.seconds)}
            disabled={sending}
            className="w-full rounded-lg border border-black/10 px-3 py-2 text-left text-xs text-black/80 hover:bg-black/5 disabled:opacity-40 dark:border-white/10 dark:text-white/80 dark:hover:bg-white/10"
          >
            {p.label}
          </button>
        ))}
      </div>
      {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </DialogShell>
  );
}
