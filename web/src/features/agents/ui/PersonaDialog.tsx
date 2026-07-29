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
import { ModelCombobox, providerForModel } from "./ModelCombobox";

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
  // No longer editable in the UI — derived from the model's prefix at save
  // time. Kept as a fallback for legacy personas whose model has no prefix.
  const provider = existing?.provider ?? "";
  const [respondTo, setRespondTo] = useState<RespondTo>(
    (existing?.respondTo as RespondTo | null) ?? "anyone",
  );
  const [allowlistText, setAllowlistText] = useState((existing?.respondToAllowlist ?? []).join("\n"));
  const [shared, setShared] = useState(existing?.shared ?? false);
  const [localError, setLocalError] = useState<string | null>(null);
  // Desktop-contract fields the dialog doesn't edit — preserved verbatim so
  // saving a desktop-authored persona from web doesn't strip them.
  const namePool = existing?.namePool;
  const parallelism = existing?.parallelism ?? undefined;

  async function submit() {
    if (!displayName.trim()) {
      setLocalError("Display name is required.");
      return;
    }
    const respondToAllowlist = allowlistText.split(/[\s,]+/).filter(Boolean);
    if (respondTo === "allowlist" && respondToAllowlist.length === 0) {
      setLocalError("Add at least one pubkey to the allowlist, or choose a different audience.");
      return;
    }
    setLocalError(null);
    try {
      await savePersona(
        {
          displayName, systemPrompt, avatarUrl, runtime, model,
          // Keyless OpenRouter: the provider is the model string's prefix.
          // Bare legacy ids (no prefix) keep the previously stored provider.
          provider: providerForModel(model) || provider,
          respondTo, respondToAllowlist, parallelism, namePool, shared,
        },
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
          <div className="col-span-2">
            <label className={labelCls}>Model</label>
            <ModelCombobox id="persona-model" value={model} onChange={setModel} />
          </div>
        </div>
        <p className="-mt-2 text-[11px] leading-snug text-black/40 dark:text-white/40">
          Served by the keyless OpenRouter provider — search the catalog or type any
          {" "}model id.
        </p>
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
        {respondTo === "allowlist" && (
          <div>
            <label className={labelCls}>Allowlist pubkeys <span className="font-normal text-black/35 dark:text-white/35">(hex, one per line)</span></label>
            <textarea
              className={`${inputCls} min-h-16 resize-y font-mono text-xs`}
              value={allowlistText}
              onChange={(e) => setAllowlistText(e.target.value)}
              placeholder="pubkey hex…"
            />
          </div>
        )}
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
