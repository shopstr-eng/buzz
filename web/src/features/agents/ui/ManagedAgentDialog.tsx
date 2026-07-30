/**
 * Create dialog for managed agent records (kind 30177).
 *
 * Creation generates a fresh Nostr keypair for the agent — the record's d-tag
 * is the agent's own pubkey (desktop contract). The secret key is shown ONCE
 * after publish; the web never stores it. Running the agent requires
 * provisioning that key to an ACP worker and adding the agent to channels.
 */

import { useState } from "react";
import { Copy, Check, TriangleAlert } from "lucide-react";
import type { AgentPersona, ManagedAgent } from "../use-agents";
import { useAgentPublishing } from "../use-agent-publishing";
import { agentToFormInput, type RespondTo } from "../agent-events";
import {
  AgentDialogShell,
  DialogError,
  btnPrimaryCls,
  btnSecondaryCls,
  inputCls,
  labelCls,
} from "./agent-dialog-shell";
import { ModelCombobox, providerForModel } from "./ModelCombobox";

export function ManagedAgentDialog({
  personas,
  existing,
  onClose,
}: {
  personas: AgentPersona[];
  existing?: ManagedAgent | null;
  onClose: () => void;
}) {
  const { createManagedAgent, updateManagedAgent, isPublishing, error } = useAgentPublishing();
  // Edit prefill goes through the tested mapper so every write-contract
  // field survives the round-trip (see agent-events.test.ts).
  const [prefill] = useState(() => (existing ? agentToFormInput(existing) : null));
  const [name, setName] = useState(prefill?.name ?? "");
  const [personaId, setPersonaId] = useState(prefill?.personaId ?? "");
  const [systemPrompt, setSystemPrompt] = useState(prefill?.systemPrompt ?? "");
  const [model, setModel] = useState(prefill?.model ?? "");
  const [respondTo, setRespondTo] = useState<RespondTo>(prefill?.respondTo ?? "owner-only");
  const [allowlistText, setAllowlistText] = useState((prefill?.respondToAllowlist ?? []).join("\n"));
  const [parallelism, setParallelism] = useState(prefill?.parallelism ?? 1);
  const [localError, setLocalError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ pubkey: string; nsec: string } | null>(null);
  const [copied, setCopied] = useState(false);

  async function submit() {
    if (!name.trim()) {
      setLocalError("Agent name is required.");
      return;
    }
    const respondToAllowlist = allowlistText.split(/[\s,]+/).filter(Boolean);
    if (respondTo === "allowlist" && respondToAllowlist.length === 0) {
      setLocalError("Add at least one pubkey to the allowlist, or choose a different audience.");
      return;
    }
    setLocalError(null);
    const input = {
      name,
      personaId: personaId || undefined,
      systemPrompt: systemPrompt || undefined,
      model: model || undefined,
      // Keyless OpenRouter: the provider is the model string's prefix. On
      // edit, keep a stored provider that the prefix rule can't re-derive.
      provider: providerForModel(model) || prefill?.provider || undefined,
      // Desktop-contract field with no form control — pass through verbatim.
      personaSourceVersion: prefill?.personaSourceVersion,
      respondTo,
      respondToAllowlist,
      parallelism: Math.max(1, Math.floor(parallelism) || 1),
    };
    try {
      if (existing) {
        await updateManagedAgent(input, existing.id);
        onClose();
      } else {
        setCreated(await createManagedAgent(input));
      }
    } catch {
      /* surfaced via hook error */
    }
  }

  async function copyNsec() {
    if (!created) return;
    await navigator.clipboard.writeText(created.nsec);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (created) {
    return (
      <AgentDialogShell title="Agent key created" onClose={onClose}>
        <div className="space-y-4 p-5">
          <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            This secret key is shown once and never stored by the web app. Save it now.
          </p>
          <div>
            <label className={labelCls}>Agent secret key (nsec)</label>
            <div className="flex gap-2">
              <code className="flex-1 truncate rounded-lg border border-black/15 bg-black/5 px-3 py-2 text-xs text-black/70 dark:border-white/15 dark:bg-white/5 dark:text-white/70">
                {created.nsec}
              </code>
              <button className={btnSecondaryCls} onClick={copyNsec} aria-label="Copy secret key">
                {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <p className="text-[11px] leading-relaxed text-black/45 dark:text-white/45">
            The agent record is live in your directory. To actually run it, provision this key to an
            agent worker (e.g. as <code>BUZZ_ACP_PRIVATE_KEY</code>) and add the agent to a channel —
            it starts answering @mentions as soon as it discovers one.
          </p>
        </div>
        <div className="flex justify-end border-t border-black/8 px-5 py-3 dark:border-white/8">
          <button className={btnPrimaryCls} onClick={onClose}>Done</button>
        </div>
      </AgentDialogShell>
    );
  }

  return (
    <AgentDialogShell title={existing ? "Edit managed agent" : "New managed agent"} onClose={onClose}>
      <div className="space-y-4 p-5">
        <DialogError message={localError ?? error} />
        <div>
          <label className={labelCls}>Agent name</label>
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Nightly runner" autoFocus />
        </div>
        <div>
          <label className={labelCls}>Persona <span className="font-normal text-black/35 dark:text-white/35">(optional — supplies runtime config)</span></label>
          <select className={inputCls} value={personaId} onChange={(e) => setPersonaId(e.target.value)}>
            <option value="">None — configure inline</option>
            {personas.map((p) => (
              <option key={p.id} value={p.id}>{p.displayName}</option>
            ))}
          </select>
        </div>
        {!personaId && (
          <>
            <div>
              <label className={labelCls}>System prompt</label>
              <textarea
                className={`${inputCls} min-h-16 resize-y`}
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder="You are…"
              />
            </div>
            <div>
              <label className={labelCls}>Model</label>
              <ModelCombobox id="managed-agent-model" value={model} onChange={setModel} />
              <p className="mt-1.5 text-[11px] leading-snug text-black/40 dark:text-white/40">
                Served by the keyless OpenRouter provider — search the catalog or type any
                {" "}model id.
              </p>
            </div>
          </>
        )}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={labelCls}>Responds to</label>
            <select className={inputCls} value={respondTo} onChange={(e) => setRespondTo(e.target.value as RespondTo)}>
              <option value="owner-only">Owner only</option>
              <option value="allowlist">Allowlist</option>
              <option value="anyone">Anyone</option>
            </select>
          </div>
          {respondTo === "allowlist" && (
            <div className="col-span-2">
              <label className={labelCls}>Allowlist pubkeys <span className="font-normal text-black/35 dark:text-white/35">(hex, one per line)</span></label>
              <textarea
                className={`${inputCls} min-h-16 resize-y font-mono text-xs`}
                value={allowlistText}
                onChange={(e) => setAllowlistText(e.target.value)}
                placeholder="pubkey hex…"
              />
            </div>
          )}
          <div>
            <label className={labelCls}>Parallelism</label>
            <input
              className={inputCls}
              type="number"
              min={1}
              value={parallelism}
              onChange={(e) => setParallelism(Number(e.target.value))}
            />
          </div>
        </div>
      </div>
      <div className="flex justify-end gap-2 border-t border-black/8 px-5 py-3 dark:border-white/8">
        <button className={btnSecondaryCls} onClick={onClose}>Cancel</button>
        <button className={btnPrimaryCls} onClick={submit} disabled={isPublishing}>
          {isPublishing ? "Publishing…" : existing ? "Save changes" : "Create agent"}
        </button>
      </div>
    </AgentDialogShell>
  );
}
