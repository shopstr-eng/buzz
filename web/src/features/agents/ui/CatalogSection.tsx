/**
 * Community catalog section: shared personas from other members with an
 * "Add" action that copies them into the owner's private persona list
 * (fresh slug, shared:false — re-sharing is an explicit later action).
 * Avatars render through <img src>, where SVG scripts never execute —
 * same trust model as the desktop catalog.
 */

import { useMemo } from "react";
import { Bot, Check, Plus } from "lucide-react";
import type { CatalogPersona } from "../lib/agent-catalog";
import { truncatePubkey } from "@/shared/lib/pubkey";
import { useProfiles } from "@/shared/hooks/use-profiles";

export function CatalogSection({
  entries,
  copied,
  addingId,
  onAdd,
}: {
  entries: CatalogPersona[];
  copied: Set<string>;
  addingId: string | null;
  onAdd: (entry: CatalogPersona) => void;
}) {
  // Resolve publisher display names (desktop catalog parity) — falls back to
  // the truncated pubkey when the author has no kind:0/10100 profile.
  const authorPubkeys = useMemo(
    () => entries.map((e) => e.authorPubkey),
    [entries],
  );
  const profiles = useProfiles(authorPubkeys);

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {entries.map((entry) => {
        const isCopied = copied.has(entry.coordinate);
        const isAdding = addingId === entry.coordinate;
        return (
          <div
            key={entry.coordinate}
            className="rounded-lg border border-black/8 px-3 py-2 dark:border-white/8"
          >
            <p className="flex items-center gap-2 text-xs font-semibold text-black dark:text-white">
              {entry.avatarUrl ? (
                <img src={entry.avatarUrl} alt="" className="h-6 w-6 shrink-0 rounded-full" />
              ) : (
                <Bot className="h-5 w-5 shrink-0 text-violet-500" />
              )}
              <span className="truncate">{entry.displayName}</span>
            </p>
            <p className="mt-0.5 text-[10px] text-black/35 dark:text-white/35">
              by {profiles.get(entry.authorPubkey)?.name ?? truncatePubkey(entry.authorPubkey)}
              {entry.model ? ` · ${entry.model}` : ""}
            </p>
            {entry.systemPrompt && (
              <p className="mt-1 line-clamp-2 text-[11px] text-black/55 dark:text-white/55">
                {entry.systemPrompt}
              </p>
            )}
            <button
              type="button"
              disabled={isCopied || isAdding}
              onClick={() => onAdd(entry)}
              className="mt-2 flex items-center gap-1 rounded-md border border-violet-500/40 px-2 py-1 text-[10px] font-medium text-violet-600 transition-colors hover:bg-violet-500/10 disabled:cursor-default disabled:border-black/10 disabled:text-black/35 dark:text-violet-300 dark:disabled:border-white/10 dark:disabled:text-white/35"
            >
              {isCopied ? (
                <>
                  <Check className="h-3 w-3" /> Added
                </>
              ) : (
                <>
                  <Plus className="h-3 w-3" /> {isAdding ? "Adding…" : "Add to my agents"}
                </>
              )}
            </button>
          </div>
        );
      })}
    </div>
  );
}
