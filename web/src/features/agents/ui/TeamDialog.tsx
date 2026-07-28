/**
 * Create/edit dialog for agent teams (kind 30176). Teams group personas under
 * shared instructions; publishes the desktop-compatible snapshot.
 */

import { useState } from "react";
import type { AgentPersona, AgentTeam } from "../use-agents";
import { useAgentPublishing } from "../use-agent-publishing";
import {
  AgentDialogShell,
  DialogError,
  btnPrimaryCls,
  btnSecondaryCls,
  inputCls,
  labelCls,
} from "./agent-dialog-shell";

export function TeamDialog({
  existing,
  personas,
  onClose,
}: {
  existing: AgentTeam | null;
  personas: AgentPersona[];
  onClose: () => void;
}) {
  const { saveTeam, isPublishing, error } = useAgentPublishing();
  const [name, setName] = useState(existing?.name ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [instructions, setInstructions] = useState(existing?.instructions ?? "");
  const [personaIds, setPersonaIds] = useState<string[]>(existing?.personaIds ?? []);
  const [localError, setLocalError] = useState<string | null>(null);

  function togglePersona(id: string) {
    setPersonaIds((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));
  }

  async function submit() {
    if (!name.trim()) {
      setLocalError("Team name is required.");
      return;
    }
    setLocalError(null);
    try {
      await saveTeam({ name, description, instructions, personaIds }, existing?.id ?? null);
      onClose();
    } catch {
      /* surfaced via hook error */
    }
  }

  return (
    <AgentDialogShell title={existing ? "Edit team" : "New team"} onClose={onClose}>
      <div className="space-y-4 p-5">
        <DialogError message={localError ?? error} />
        <div>
          <label className={labelCls}>Team name</label>
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ops team" autoFocus />
        </div>
        <div>
          <label className={labelCls}>Description <span className="font-normal text-black/35 dark:text-white/35">(optional)</span></label>
          <input className={inputCls} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this team handles" />
        </div>
        <div>
          <label className={labelCls}>Instructions <span className="font-normal text-black/35 dark:text-white/35">(optional)</span></label>
          <textarea
            className={`${inputCls} min-h-20 resize-y`}
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="Shared guidance for every persona in this team…"
          />
        </div>
        <div>
          <label className={labelCls}>Personas ({personaIds.length})</label>
          {personas.length === 0 ? (
            <p className="rounded-lg border border-dashed border-black/15 px-3 py-3 text-center text-xs text-black/40 dark:border-white/15 dark:text-white/40">
              No personas yet — create one first.
            </p>
          ) : (
            <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-black/10 p-2 dark:border-white/10">
              {personas.map((p) => (
                <label key={p.id} className="flex items-center gap-2 rounded px-2 py-1 text-xs text-black/70 hover:bg-black/5 dark:text-white/70 dark:hover:bg-white/10">
                  <input type="checkbox" checked={personaIds.includes(p.id)} onChange={() => togglePersona(p.id)} />
                  <span className="truncate">{p.displayName}</span>
                  <span className="truncate text-[10px] text-black/30 dark:text-white/30">{p.id}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="flex justify-end gap-2 border-t border-black/8 px-5 py-3 dark:border-white/8">
        <button className={btnSecondaryCls} onClick={onClose}>Cancel</button>
        <button className={btnPrimaryCls} onClick={submit} disabled={isPublishing}>
          {isPublishing ? "Publishing…" : existing ? "Save changes" : "Create team"}
        </button>
      </div>
    </AgentDialogShell>
  );
}
