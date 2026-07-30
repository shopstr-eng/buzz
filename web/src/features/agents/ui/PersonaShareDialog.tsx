/**
 * Share dialog for a persona — web parity with desktop's redesigned
 * PersonaShareDialog (upstream #3699), scoped to web capabilities:
 *
 * - Catalog sharing is a dedicated toggle here (moved out of the edit
 *   dialog). It republishes the persona with/without ["shared","true"] via
 *   the existing kind:30175 contract — the wire format is unchanged.
 * - "What's included" memory levels (agent only / + core / + all memories)
 *   bundle the linked agent's decrypted engrams into the exported
 *   .agent.json, matching desktop's export semantics (core = core entry
 *   only; everything = core + all live entries sorted by slug).
 * - Memory-bearing exports require an explicit plaintext-memory confirm.
 *
 * Desktop's DM-send and copy-link paths depend on its media upload pipeline
 * (Blossom via Tauri), which web doesn't have yet — export covers the
 * "hand someone a copy" flow until then.
 */

import { useState } from "react";
import { AlertCircle, BookUser, Download } from "lucide-react";
import type { AgentPersona } from "../use-agents";
import type { MemoryGraph } from "../lib/engrams";
import {
  buildSnapshot,
  selectMemoryEntries,
  type SnapshotMemoryLevel,
} from "../lib/agent-snapshot";
import { AgentDialogShell, DialogError, labelCls, inputCls } from "./agent-dialog-shell";

const SHARE_LEVELS: { value: SnapshotMemoryLevel; label: string }[] = [
  { value: "none", label: "Agent only" },
  { value: "core", label: "Agent + core memory" },
  { value: "everything", label: "Agent + all memories" },
];

export function PersonaShareDialog({
  persona,
  memoryGraph,
  isPublishing,
  publishError,
  onCatalogSharedChange,
  onClose,
}: {
  persona: AgentPersona;
  /** Linked agent's decrypted memory graph; null when no linked agent / no nip44. */
  memoryGraph: MemoryGraph | null;
  isPublishing: boolean;
  publishError: string | null;
  /** Republishes the persona with the shared tag flipped (kind:30175 contract). */
  onCatalogSharedChange: (shared: boolean) => void;
  onClose: () => void;
}) {
  const [shareLevel, setShareLevel] = useState<SnapshotMemoryLevel>("none");
  const hasMemoryOptions =
    memoryGraph !== null &&
    (memoryGraph.core !== null || memoryGraph.reachable.size > 0 || memoryGraph.orphans.length > 0);
  const effectiveLevel = hasMemoryOptions ? shareLevel : "none";

  /** Download a .agent.json snapshot at the chosen memory level. */
  function handleExport(): void {
    if (effectiveLevel !== "none") {
      const memoryLabel = effectiveLevel === "core" ? "core memory" : "all memories";
      const confirmed = window.confirm(
        `Share memories?\n\nThis agent snapshot includes plaintext ${memoryLabel}. ` +
          "Anyone with the file can read it. Only share with people you trust.",
      );
      if (!confirmed) return;
    }
    const entries = memoryGraph ? selectMemoryEntries(memoryGraph, effectiveLevel) : [];
    const snapshot = buildSnapshot(persona, { level: effectiveLevel, entries });
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${persona.id}.agent.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <AgentDialogShell title={`Share ${persona.displayName}`} onClose={onClose}>
      <div className="space-y-4 p-5">
        <DialogError message={publishError} />
        <p className="text-xs text-black/50 dark:text-white/50">
          Anyone you share this agent with receives a copy they can add and use.
          Changes you make later won’t sync.
        </p>

        <div>
          <label className={labelCls} htmlFor="persona-share-level">
            What’s included
          </label>
          <select
            id="persona-share-level"
            className={inputCls}
            value={effectiveLevel}
            disabled={!hasMemoryOptions}
            onChange={(e) => setShareLevel(e.target.value as SnapshotMemoryLevel)}
            data-testid="persona-share-level"
          >
            {SHARE_LEVELS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {!hasMemoryOptions && (
            <p className="mt-1 text-[10px] text-black/35 dark:text-white/35">
              Memory options appear when a linked agent has decryptable memories.
            </p>
          )}
        </div>

        {effectiveLevel !== "none" && (
          <div
            className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400"
            data-testid="persona-share-memory-warning"
          >
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <p>
              Memory is stored as <strong>plaintext</strong> in the snapshot. Only
              share it with people you trust.
            </p>
          </div>
        )}

        <button
          className="flex w-full items-center gap-2 rounded-lg border border-black/15 px-3 py-2 text-sm font-medium text-black/70 hover:bg-black/5 dark:border-white/15 dark:text-white/70 dark:hover:bg-white/10"
          onClick={handleExport}
          data-testid="persona-share-export"
        >
          <Download className="h-4 w-4 shrink-0 text-black/40 dark:text-white/40" />
          Export agent (.agent.json)
        </button>

        <div className="flex items-start gap-3 rounded-lg border border-black/8 px-3 py-3 dark:border-white/8">
          <BookUser className="mt-0.5 h-4 w-4 shrink-0 text-black/40 dark:text-white/40" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-black dark:text-white">Share to catalog</p>
            <p className="text-[11px] text-black/45 dark:text-white/45">
              Anyone in this community can find and use a copy. Your agent
              instruction is shared as plaintext. Memories and secrets aren’t
              included.
            </p>
          </div>
          <input
            type="checkbox"
            className="mt-1"
            aria-label="Share to catalog"
            checked={persona.shared}
            disabled={isPublishing}
            onChange={(e) => onCatalogSharedChange(e.target.checked)}
            data-testid="persona-share-catalog-access"
          />
        </div>
      </div>
    </AgentDialogShell>
  );
}
