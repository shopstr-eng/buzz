/**
 * Community catalog section: shared personas (kind 30175) and shared teams
 * (kind 30178) from other members with an "Add" action that copies them
 * into the owner's private lists (fresh slugs/ids, shared:false —
 * re-sharing is an explicit later action). A shared team embeds EVERY
 * member's full instructions — the card copy says so explicitly (NIP-AP).
 * Avatars render through <img src>, where SVG scripts never execute —
 * same trust model as the desktop catalog.
 */

import { useMemo } from "react";
import { Bot, Check, Plus, Users } from "lucide-react";
import type { CatalogPersona } from "../lib/agent-catalog";
import type { CatalogTeam } from "../lib/team-catalog";
import { truncatePubkey } from "@/shared/lib/pubkey";
import { relativeTime } from "@/shared/lib/relative-time";
import { useProfiles } from "@/shared/hooks/use-profiles";

function AddButton({
  isCopied,
  isAdding,
  onAdd,
  label,
}: {
  isCopied: boolean;
  isAdding: boolean;
  onAdd: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      disabled={isCopied || isAdding}
      onClick={onAdd}
      className="mt-2 flex items-center gap-1 rounded-md border border-violet-500/40 px-2 py-1 text-[10px] font-medium text-violet-600 transition-colors hover:bg-violet-500/10 disabled:cursor-default disabled:border-black/10 disabled:text-black/35 dark:text-violet-300 dark:disabled:border-white/10 dark:disabled:text-white/35"
    >
      {isCopied ? (
        <>
          <Check className="h-3 w-3" /> Added
        </>
      ) : (
        <>
          <Plus className="h-3 w-3" /> {isAdding ? "Adding…" : label}
        </>
      )}
    </button>
  );
}

export function CatalogSection({
  entries,
  teams,
  copied,
  addingId,
  onAdd,
  onAddTeam,
}: {
  entries: CatalogPersona[];
  teams: CatalogTeam[];
  copied: Set<string>;
  addingId: string | null;
  onAdd: (entry: CatalogPersona) => void;
  onAddTeam: (team: CatalogTeam) => void;
}) {
  // Resolve publisher display names (desktop catalog parity) — falls back to
  // the truncated pubkey when the author has no kind:0/10100 profile.
  const authorPubkeys = useMemo(
    () => [...entries.map((e) => e.authorPubkey), ...teams.map((t) => t.authorPubkey)],
    [entries, teams],
  );
  const profiles = useProfiles(authorPubkeys);
  const publisherName = (pubkey: string) => profiles.get(pubkey)?.name ?? truncatePubkey(pubkey);

  return (
    <div className="space-y-2">
      {teams.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2">
          {teams.map((team) => {
            const isCopied = copied.has(team.coordinate);
            const isAdding = addingId === team.coordinate;
            return (
              <div
                key={team.coordinate}
                className="rounded-lg border border-black/8 px-3 py-2 dark:border-white/8"
              >
                <p className="flex items-center gap-2 text-xs font-semibold text-black dark:text-white">
                  <Users className="h-5 w-5 shrink-0 text-violet-500" />
                  <span className="truncate">{team.name}</span>
                  <span className="ml-auto shrink-0 rounded-full bg-violet-500/10 px-1.5 py-0.5 text-[9px] font-medium text-violet-600 dark:text-violet-300">
                    Team · {team.members.length}
                  </span>
                </p>
                <p className="mt-0.5 text-[10px] text-black/35 dark:text-white/35">
                  by {publisherName(team.authorPubkey)} · shared {relativeTime(team.createdAt)}
                </p>
                {team.tagline && (
                  <p className="mt-1 line-clamp-2 text-[11px] text-black/55 dark:text-white/55">
                    {team.tagline}
                  </p>
                )}
                {team.members.length > 0 && (
                  <p className="mt-1 truncate text-[10px] text-black/45 dark:text-white/45">
                    {team.members.map((m) => m.displayName).join(", ")}
                  </p>
                )}
                <p className="mt-1 text-[10px] text-black/40 dark:text-white/40">
                  Shared teams include every member&apos;s full instructions. Adding copies
                  {" "}them all into your private agents.
                </p>
                <AddButton
                  isCopied={isCopied}
                  isAdding={isAdding}
                  onAdd={() => onAddTeam(team)}
                  label="Add team + members"
                />
              </div>
            );
          })}
        </div>
      )}
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
              {entry.model ? ` · ${entry.model}` : ""} · shared {relativeTime(entry.createdAt)}
            </p>
            {entry.systemPrompt && (
              <p className="mt-1 line-clamp-2 text-[11px] text-black/55 dark:text-white/55">
                {entry.systemPrompt}
              </p>
            )}
            <AddButton
              isCopied={isCopied}
              isAdding={isAdding}
              onAdd={() => onAdd(entry)}
              label="Add to my agents"
            />
          </div>
        );
      })}
      </div>
    </div>
  );
}
