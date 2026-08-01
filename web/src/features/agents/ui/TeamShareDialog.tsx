/**
 * Share dialog for a team — publishes/retracts the kind:30178 team-catalog
 * projection (NIP-AP). Mirrors the persona share dialog's catalog toggle,
 * with the NIP-AP-mandated warning: sharing a team exposes EVERY member's
 * full instructions, including members whose own personas are private.
 */

import { AlertCircle, BookUser, Bot, RefreshCw } from "lucide-react";
import type { AgentPersona, AgentTeam } from "../use-agents";
import { AgentDialogShell, DialogError } from "./agent-dialog-shell";

export function TeamShareDialog({
  team,
  members,
  missingMemberCount,
  shared,
  isStale,
  isPublishing,
  publishError,
  onSharedChange,
  onClose,
}: {
  team: AgentTeam;
  /** Resolved member personas (team.personaIds that still exist locally). */
  members: AgentPersona[];
  /** personaIds that no longer resolve to a persona (deleted) — excluded from the share. */
  missingMemberCount: number;
  shared: boolean;
  /** Shared, but the published snapshot no longer matches the current team/member fields. */
  isStale: boolean;
  isPublishing: boolean;
  publishError: string | null;
  /** Publishes the 30178 projection with/without the ["shared","true"] tag. */
  onSharedChange: (shared: boolean) => void;
  onClose: () => void;
}) {
  return (
    <AgentDialogShell title={`Share ${team.name}`} onClose={onClose}>
      <div className="space-y-4 p-5">
        <DialogError message={publishError} />
        <p className="text-xs text-black/50 dark:text-white/50">
          Sharing publishes a snapshot of this team to the community catalog.
          Anyone in this community can find it and import a copy. Changes you
          make later won’t sync until you re-share.
        </p>

        {shared && isStale && (
          <div
            className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400"
            data-testid="team-share-stale-warning"
          >
            <RefreshCw className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <p>
                The shared snapshot is <strong>out of date</strong> — the team or
                its members changed since it was published. The catalog still
                shows the old version.
              </p>
              <button
                className="mt-1.5 rounded-lg bg-amber-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-amber-700 disabled:opacity-50"
                disabled={isPublishing}
                onClick={() => onSharedChange(true)}
                data-testid="team-share-stale-reshare"
              >
                Re-share current version
              </button>
            </div>
          </div>
        )}

        <div
          className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400"
          data-testid="team-share-members-warning"
        >
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <p>
            Sharing a team exposes the <strong>full instructions of every
            member</strong> as plaintext — including members whose personas are
            private and not individually shared. Allowlists, memories, and
            secrets are never included.
          </p>
        </div>

        <div>
          <p className="mb-1.5 text-xs font-semibold text-black/60 dark:text-white/60">
            Members included ({members.length})
          </p>
          {members.length === 0 ? (
            <p className="rounded-lg border border-dashed border-black/15 px-3 py-3 text-center text-[11px] text-black/40 dark:border-white/15 dark:text-white/40">
              This team has no members — the shared snapshot will be empty.
            </p>
          ) : (
            <ul className="space-y-1">
              {members.map((m) => (
                <li
                  key={m.id}
                  className="flex items-center gap-2 rounded-lg border border-black/8 px-3 py-1.5 dark:border-white/8"
                  data-testid={`team-share-member-${m.id}`}
                >
                  <Bot className="h-3.5 w-3.5 shrink-0 text-violet-500" />
                  <span className="min-w-0 flex-1 truncate text-xs text-black/70 dark:text-white/70">
                    {m.displayName}
                  </span>
                  {!m.shared && (
                    <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
                      private persona
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {missingMemberCount > 0 && (
            <p className="mt-1 text-[10px] text-black/35 dark:text-white/35">
              {missingMemberCount} member{missingMemberCount === 1 ? "" : "s"} no
              longer exist{missingMemberCount === 1 ? "s" : ""} and will be left
              out of the share.
            </p>
          )}
        </div>

        <div className="flex items-start gap-3 rounded-lg border border-black/8 px-3 py-3 dark:border-white/8">
          <BookUser className="mt-0.5 h-4 w-4 shrink-0 text-black/40 dark:text-white/40" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-black dark:text-white">Share to catalog</p>
            <p className="text-[11px] text-black/45 dark:text-white/45">
              Turning this off retracts the team from the catalog (the snapshot
              stays visible only to you).
            </p>
          </div>
          <input
            type="checkbox"
            className="mt-1"
            aria-label="Share team to catalog"
            checked={shared}
            disabled={isPublishing}
            onChange={(e) => onSharedChange(e.target.checked)}
            data-testid="team-share-catalog-access"
          />
        </div>
      </div>
    </AgentDialogShell>
  );
}
