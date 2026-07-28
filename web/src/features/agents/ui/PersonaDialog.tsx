/**
 * Create/edit dialog for personas (kind 30175). Publishes an owner-signed
 * snapshot matching the desktop write contract; the directory subscription
 * picks the echo up automatically.
 */

import { useState } from "react";
import type { AgentPersona } from "../use-agents";
import { useAgentPublishing } from "../use-agent-publishing";
import type { RespondTo } from "../agent-events";
import {
  AgentDialogShell,
  DialogError,
  btnPrimaryCls,
  btnSecondaryCls,
  inputCls,
  labelCls,
} from "./agent-dialog-shell";

const RESPOND_TO_OPTIONS: { value: RespondTo; label: string }[] = [
  { value: "anyone", label: "Anyone" },
  { value: "owner-only", label: "Owner only" },
  { value: "allowlist", label: "Allowlist" },
];

export function PersonaDialog({
  existing,
  takenSlugs,
  onClose,
}: {
  /** Null for create; the persona being edited otherwise. */
  existing: AgentPersona | null;
  /** d-tags already in use — colliding slugs would silently replace another persona. */
  takenSlugs: string[];
  onClose: () => void;
}) {
  const { savePersona, isPublishing, error } = useAgentPublishing();
  const [displayName, setDisplayName] = useState(existing?.displayName ?? "");
  const [systemPrompt, setSystemPrompt] = useState(existing?.systemPrompt ?? "");
  const [avatarUrl, setAvatarUrl] = useState(existing?.avatarUrl ?? "");
  const [runtime, setRuntime] = useState(existing?.runtime ?? "");
  const [model, setModel] = useState(existing?.model ?? "");
  const [provider, setProvider] = useState(existing?.provider ?? "");
  const [respondTo, setRespondTo] = useState<RespondTo>(
    (existing?.respondTo as RespondTo | null) ?? "anyone",
  );
  const [shared, setShared] = useState(existing?.shared ?? false);
  const [localError, setLocalError] = useState<string | null>(null);

  async function submit() {
    if (!displayName.trim()) {
      setLocalError("Display name is required.");
      return;
    }
    setLocalError(null);
    try {
      await savePersona(
        { displayName, systemPrompt, avatarUrl, runtime, model, provider, respondTo, shared },
        existing?.id ?? null,
        takenSlugs,
      );
      onClose();
    } catch {
      /* surfaced via hook error */
    }
  }

  return (
    <AgentDialogShell title={existing ? "Edit persona" : "New persona"} onClose={onClose}>
      <div className="space-y-4 p-5">
        <DialogError message={localError ?? error} />
        <div>
          <label className={labelCls}>Display name</label>
          <input className={inputCls} value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Support Bot" autoFocus />
        </div>
        <div>
          <label className={labelCls}>System prompt</label>
          <textarea
            className={`${inputCls} min-h-24 resize-y`}
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            placeholder="You are a helpful support agent…"
          />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className={labelCls}>Runtime</label>
            <input className={inputCls} value={runtime} onChange={(e) => setRuntime(e.target.value)} placeholder="buzz-agent" />
          </div>
          <div>
            <label className={labelCls}>Model</label>
            <input className={inputCls} value={model} onChange={(e) => setModel(e.target.value)} placeholder="claude-opus-4-5" />
          </div>
          <div>
            <label className={labelCls}>Provider</label>
            <input className={inputCls} value={provider} onChange={(e) => setProvider(e.target.value)} placeholder="anthropic" />
          </div>
        </div>
        <div>
          <label className={labelCls}>Avatar URL <span className="font-normal text-black/35 dark:text-white/35">(optional)</span></label>
          <input className={inputCls} value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} placeholder="https://…" />
        </div>
        <div>
          <label className={labelCls}>Responds to</label>
          <select className={inputCls} value={respondTo} onChange={(e) => setRespondTo(e.target.value as RespondTo)}>
            {RESPOND_TO_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <label className="flex items-start gap-2 text-xs text-black/60 dark:text-white/60">
          <input type="checkbox" className="mt-0.5" checked={shared} onChange={(e) => setShared(e.target.checked)} />
          <span>
            Share to the community agent catalog
            <span className="block text-[10px] text-black/35 dark:text-white/35">
              Other members can read this persona. Secrets are never published.
            </span>
          </span>
        </label>
      </div>
      <div className="flex justify-end gap-2 border-t border-black/8 px-5 py-3 dark:border-white/8">
        <button className={btnSecondaryCls} onClick={onClose}>Cancel</button>
        <button className={btnPrimaryCls} onClick={submit} disabled={isPublishing}>
          {isPublishing ? "Publishing…" : existing ? "Save changes" : "Create persona"}
        </button>
      </div>
    </AgentDialogShell>
  );
}
