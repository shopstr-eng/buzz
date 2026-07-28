/**
 * Shared chrome + form atoms for the agent directory dialogs
 * (persona / team / managed agent).
 */

import { X } from "lucide-react";

export function AgentDialogShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-xl border border-black/10 bg-white shadow-xl dark:border-white/10 dark:bg-[#1A1A1A]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-black/8 px-5 py-3 dark:border-white/8">
          <h2 className="text-sm font-semibold text-black dark:text-white">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-black/40 hover:bg-black/5 dark:text-white/40 dark:hover:bg-white/10"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export const inputCls =
  "w-full rounded-lg border border-black/15 bg-transparent px-3 py-2 text-sm text-black placeholder-black/30 focus:border-violet-500 focus:outline-none dark:border-white/15 dark:text-white dark:placeholder-white/30";

export const labelCls = "mb-1.5 block text-xs font-semibold text-black/60 dark:text-white/60";

export const btnPrimaryCls =
  "rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-50";

export const btnSecondaryCls =
  "rounded-lg border border-black/15 px-4 py-2 text-sm font-medium text-black/70 hover:bg-black/5 dark:border-white/15 dark:text-white/70 dark:hover:bg-white/10";

export function DialogError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
      {message}
    </p>
  );
}
