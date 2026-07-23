/**
 * Dialog to connect an AI agent to an existing channel.
 *
 * Preset mode  — picks a built-in AI model; publishes kind:9002 to update the
 *                channel's model/credentials so the ACP can provision it.
 *
 * Custom mode  — accepts any Nostr pubkey (hex or npub); publishes kind:9000
 *                to add that pubkey as a channel member with the "agent" role.
 */

import { useState } from "react";
import {
  X, Bot, KeyRound, Eye, EyeOff, Sparkles, UserPlus,
} from "lucide-react";
import { nip19 } from "nostr-tools";
import { useRelay } from "@/shared/context/relay-context";
import { getSignFn } from "@/shared/lib/identity";
import {
  KIND_EDIT_METADATA,
  KIND_ADD_MEMBER,
  AI_MODELS,
  type ModelPreset,
  type CredentialField,
} from "../types";

interface Props {
  groupId: string;
  onClose: () => void;
}

type Tab = "preset" | "custom";

/* ── helpers ─────────────────────────────────────────────────────────────── */

function parsePubkey(input: string): string | null {
  const t = input.trim();
  if (/^[0-9a-fA-F]{64}$/.test(t)) return t.toLowerCase();
  try {
    const decoded = nip19.decode(t);
    if (decoded.type === "npub") return decoded.data as string;
  } catch { /* fall through */ }
  return null;
}

/* ── sub-components ──────────────────────────────────────────────────────── */

function ModelCard({
  preset,
  selected,
  onSelect,
}: {
  preset: ModelPreset;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${
        selected
          ? "border-violet-500 bg-violet-50 dark:border-violet-400 dark:bg-violet-900/20"
          : "border-black/10 hover:border-black/20 hover:bg-black/3 dark:border-white/10 dark:hover:border-white/20 dark:hover:bg-white/5"
      }`}
    >
      <div
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${
          selected ? "bg-violet-100 dark:bg-violet-800/50" : "bg-black/5 dark:bg-white/10"
        }`}
      >
        <Bot
          className={`h-4 w-4 ${
            selected ? "text-violet-600 dark:text-violet-400" : "text-black/40 dark:text-white/40"
          }`}
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-semibold text-black dark:text-white">{preset.name}</div>
        <div className="text-[10px] text-black/40 dark:text-white/40">{preset.description}</div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className="rounded bg-black/5 px-1.5 py-0.5 text-[10px] font-medium text-black/50 dark:bg-white/10 dark:text-white/50">
          {preset.provider}
        </span>
        {preset.credentials?.length ? (
          <span className="flex items-center gap-0.5 text-[10px] text-amber-600 dark:text-amber-400">
            <KeyRound className="h-2.5 w-2.5" /> key required
          </span>
        ) : (
          <span className="text-[10px] text-emerald-600 dark:text-emerald-400">no setup</span>
        )}
      </div>
      <div
        className={`h-3.5 w-3.5 shrink-0 rounded-full border-2 ${
          selected
            ? "border-violet-500 bg-violet-500 dark:border-violet-400 dark:bg-violet-400"
            : "border-black/20 dark:border-white/20"
        }`}
      />
    </button>
  );
}

function SecretInput({
  field,
  value,
  onChange,
}: {
  field: CredentialField;
  value: string;
  onChange: (v: string) => void;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div>
      <label className="mb-1.5 block text-xs font-semibold text-black/60 dark:text-white/60">
        {field.label} <span className="text-red-500">*</span>
      </label>
      <div className="relative">
        <input
          type={visible ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder ?? ""}
          autoComplete="off"
          spellCheck={false}
          className="w-full rounded-md border border-black/15 bg-white py-2 pl-3 pr-9 font-mono text-sm text-black placeholder-black/25 outline-none focus:border-black/40 dark:border-white/15 dark:bg-[#222] dark:text-white dark:placeholder-white/25 dark:focus:border-white/40"
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-black/30 transition-colors hover:text-black/60 dark:text-white/30 dark:hover:text-white/60"
        >
          {visible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        </button>
      </div>
      {field.hint && (
        <p className="mt-1 text-[11px] text-black/40 dark:text-white/40">{field.hint}</p>
      )}
    </div>
  );
}

/* ── Main dialog ─────────────────────────────────────────────────────────── */

export function ConnectAgentDialog({ groupId, onClose }: Props) {
  const { connection } = useRelay();
  const [tab, setTab] = useState<Tab>("preset");

  // Preset state
  const [selectedModel, setSelectedModel] = useState<ModelPreset | null>(null);
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  function setCredential(key: string, value: string) {
    setCredentials((prev) => ({ ...prev, [key]: value }));
  }

  // Custom state
  const [pubkeyInput, setPubkeyInput] = useState("");
  const pubkeyValid = parsePubkey(pubkeyInput) !== null;

  // Shared state
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const needsCredentials =
    tab === "preset" && Boolean(selectedModel?.credentials?.length);
  const credentialsFilled =
    !needsCredentials ||
    (selectedModel?.credentials ?? []).every((f) => credentials[f.key]?.trim());

  async function handleConnect() {
    if (!connection) { setError("Not connected to relay."); return; }
    const signFn = getSignFn();
    if (!signFn) { setError("No signing key available."); return; }

    setSubmitting(true);
    setError(null);

    try {
      const now = Math.floor(Date.now() / 1000);

      if (tab === "preset") {
        if (!selectedModel) { setError("Pick a model first."); return; }
        // Update the channel's model via kind:9002 (Edit Group Metadata).
        const tags: string[][] = [
          ["h", groupId],
          ["model", selectedModel.id],
        ];
        for (const [key, value] of Object.entries(credentials)) {
          if (value.trim()) tags.push(["agent_config", key, value.trim()]);
        }
        const signed = await signFn({ kind: KIND_EDIT_METADATA, created_at: now, tags, content: "" });
        connection.publish(signed);
      } else {
        const pubkey = parsePubkey(pubkeyInput);
        if (!pubkey) { setError("Enter a valid hex pubkey or npub."); return; }
        // Add the agent as a channel member via kind:9000 (Add Member).
        const tags: string[][] = [
          ["h", groupId],
          ["p", pubkey],
          ["role", "member"],
        ];
        const signed = await signFn({ kind: KIND_ADD_MEMBER, created_at: now, tags, content: "" });
        connection.publish(signed);
      }

      setSuccess(true);
      setTimeout(onClose, 900);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect agent.");
      setSubmitting(false);
    }
  }

  const connectDisabled =
    submitting ||
    success ||
    (tab === "preset" ? !selectedModel || !credentialsFilled : !pubkeyValid);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm dark:bg-black/60"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-md rounded-xl bg-white shadow-xl dark:bg-[#1E1E1E]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-black/10 px-5 py-4 dark:border-white/10">
          <h2 className="text-sm font-semibold text-black dark:text-white">Connect an agent</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-black/30 transition-colors hover:bg-black/10 hover:text-black/60 dark:text-white/30 dark:hover:bg-white/10 dark:hover:text-white/60"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-black/10 dark:border-white/10">
          {([
            { id: "preset" as const, label: "Preset agent", Icon: Sparkles },
            { id: "custom" as const, label: "Custom pubkey", Icon: UserPlus },
          ] as const).map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => { setTab(id); setError(null); }}
              className={`flex flex-1 items-center justify-center gap-1.5 px-4 py-2.5 text-xs font-medium transition-colors ${
                tab === id
                  ? "border-b-2 border-black text-black dark:border-white dark:text-white"
                  : "text-black/40 hover:text-black/70 dark:text-white/40 dark:hover:text-white/70"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="space-y-3 p-5">
          {tab === "preset" ? (
            <>
              <div className="flex items-start gap-2.5 rounded-lg bg-violet-50 px-3 py-2.5 dark:bg-violet-900/20">
                <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-violet-600 dark:text-violet-400" />
                <p className="text-xs text-violet-800 dark:text-violet-200">
                  Select a model to activate in this channel. Credentials are stored privately on the relay.
                </p>
              </div>

              <div className="space-y-1.5">
                {AI_MODELS.map((preset) => (
                  <ModelCard
                    key={preset.id}
                    preset={preset}
                    selected={selectedModel?.id === preset.id}
                    onSelect={() => {
                      setSelectedModel(selectedModel?.id === preset.id ? null : preset);
                      setCredentials({});
                    }}
                  />
                ))}
              </div>

              {/* Credential inputs for selected model */}
              {selectedModel?.credentials?.length && (
                <div className="space-y-3 border-t border-black/10 pt-3 dark:border-white/10">
                  <div className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 dark:bg-amber-900/20">
                    <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                    <p className="text-[11px] text-amber-700 dark:text-amber-300">
                      {selectedModel.name} requires an API key to run.
                    </p>
                  </div>
                  {selectedModel.credentials.map((field) => (
                    <SecretInput
                      key={field.key}
                      field={field}
                      value={credentials[field.key] ?? ""}
                      onChange={(v) => setCredential(field.key, v)}
                    />
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              <div className="flex items-start gap-2.5 rounded-lg bg-black/5 px-3 py-2.5 dark:bg-white/8">
                <UserPlus className="mt-0.5 h-4 w-4 shrink-0 text-black/50 dark:text-white/50" />
                <p className="text-xs text-black/60 dark:text-white/60">
                  Add any Nostr agent by pubkey. The agent must authenticate with a NIP-OA attestation
                  from a relay member, or be a member itself.
                </p>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-black/60 dark:text-white/60">
                  Agent pubkey <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={pubkeyInput}
                  onChange={(e) => setPubkeyInput(e.target.value)}
                  placeholder="npub1… or 64-char hex"
                  spellCheck={false}
                  className="w-full rounded-md border border-black/15 bg-white px-3 py-2 font-mono text-sm text-black placeholder-black/25 outline-none focus:border-black/40 dark:border-white/15 dark:bg-[#222] dark:text-white dark:placeholder-white/25 dark:focus:border-white/40"
                />
                {pubkeyInput && !pubkeyValid && (
                  <p className="mt-1 text-[11px] text-red-500">
                    Must be a valid npub or 64-character hex pubkey.
                  </p>
                )}
              </div>
            </>
          )}

          {error && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-900/20 dark:text-red-400">
              {error}
            </p>
          )}
          {success && (
            <p className="rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400">
              ✓ Agent connected — channel updating…
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-black/10 px-5 py-3.5 dark:border-white/10">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-4 py-2 text-sm text-black/50 transition-colors hover:bg-black/5 hover:text-black dark:text-white/50 dark:hover:bg-white/5 dark:hover:text-white"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConnect}
            disabled={connectDisabled}
            className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-black/80 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-black dark:hover:bg-white/90"
          >
            {submitting ? "Connecting…" : "Connect agent"}
          </button>
        </div>
      </div>
    </div>
  );
}
