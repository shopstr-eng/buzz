/**
 * Two-step modal for creating a new channel.
 *
 * Step 1 — Basic info: name, type, visibility, about.
 * Step 2 — AI model (workflow only): pick a model or skip.
 *
 * API keys are provided automatically by the relay's keyless integrations.
 */

import { useState } from "react";
import {
  X, Hash, MessageSquare, Zap, Globe, Lock, Bot,
  ChevronRight, ChevronLeft, Sparkles,
} from "lucide-react";
import { useRelay } from "@/shared/context/relay-context";
import { getSignFn } from "@/shared/lib/identity";
import {
  KIND_CREATE_GROUP, AI_MODELS,
  type ChannelType, type ModelPreset,
} from "../types";
import {
  useChannelTemplates,
  type ChannelTemplate,
} from "../use-channel-templates";

interface Props { onClose: () => void }

const CHANNEL_TYPES: { value: ChannelType; label: string; desc: string; Icon: React.ElementType }[] = [
  { value: "stream",   label: "Stream",   desc: "Real-time chat",      Icon: Hash },
  { value: "forum",    label: "Forum",    desc: "Threaded discussion",  Icon: MessageSquare },
  { value: "workflow", label: "Workflow", desc: "AI-assisted tasks",    Icon: Zap },
];

/* ── Step 1: basic info ─────────────────────────────────────────────────── */

interface Step1Props {
  name: string; setName: (v: string) => void;
  channelType: ChannelType; setChannelType: (v: ChannelType) => void;
  isPrivate: boolean; setIsPrivate: (v: boolean) => void;
  about: string; setAbout: (v: string) => void;
  onApplyTemplate: (t: ChannelTemplate) => void;
  onCancel: () => void; onNext: () => void;
}

function Step1({ name, setName, channelType, setChannelType, isPrivate, setIsPrivate, about, setAbout, onApplyTemplate, onCancel, onNext }: Step1Props) {
  const { templates } = useChannelTemplates();
  return (
    <>
      <div className="space-y-4 p-5">
        {templates.length > 0 && (
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-black/60 dark:text-white/60">
              Apply a template
            </label>
            <select
              defaultValue=""
              onChange={(e) => {
                const t = templates.find((x) => x.id === e.target.value);
                if (t) onApplyTemplate(t);
                e.target.value = "";
              }}
              className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm text-black outline-none dark:border-white/15 dark:bg-[#222] dark:text-white"
            >
              <option value="">Choose a template…</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.channelType})
                </option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-black/60 dark:text-white/60">
            Channel name <span className="text-red-500">*</span>
          </label>
          <input
            autoFocus type="text" value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. general"
            className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm text-black placeholder-black/30 outline-none focus:border-black/40 dark:border-white/15 dark:bg-[#222] dark:text-white dark:placeholder-white/30 dark:focus:border-white/40"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-semibold text-black/60 dark:text-white/60">Type</label>
          <div className="grid grid-cols-3 gap-2">
            {CHANNEL_TYPES.map(({ value, label, desc, Icon }) => (
              <button key={value} type="button" onClick={() => setChannelType(value)}
                className={`flex flex-col items-start gap-1 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                  channelType === value
                    ? "border-black/40 bg-black/5 dark:border-white/40 dark:bg-white/10"
                    : "border-black/10 hover:border-black/20 dark:border-white/10 dark:hover:border-white/20"
                }`}>
                <Icon className={`h-4 w-4 ${channelType === value && value === "workflow" ? "text-violet-600 dark:text-violet-400" : channelType === value ? "text-black dark:text-white" : "text-black/40 dark:text-white/40"}`} />
                <span className="text-xs font-medium text-black dark:text-white">{label}</span>
                <span className="text-[10px] leading-tight text-black/40 dark:text-white/40">{desc}</span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-semibold text-black/60 dark:text-white/60">Visibility</label>
          <div className="flex gap-2">
            {[
              { value: false, label: "Open",    desc: "All members", Icon: Globe },
              { value: true,  label: "Private", desc: "Invite only", Icon: Lock },
            ].map(({ value, label, desc, Icon }) => (
              <button key={String(value)} type="button" onClick={() => setIsPrivate(value)}
                className={`flex flex-1 items-center gap-2 rounded-lg border px-3 py-2 transition-colors ${
                  isPrivate === value
                    ? "border-black/40 bg-black/5 dark:border-white/40 dark:bg-white/10"
                    : "border-black/10 hover:border-black/20 dark:border-white/10"
                }`}>
                <Icon className="h-3.5 w-3.5 text-black/50 dark:text-white/50" />
                <div className="text-left">
                  <div className="text-xs font-medium text-black dark:text-white">{label}</div>
                  <div className="text-[10px] text-black/40 dark:text-white/40">{desc}</div>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-semibold text-black/60 dark:text-white/60">
            Description <span className="text-black/30 dark:text-white/30">(optional)</span>
          </label>
          <textarea value={about} onChange={(e) => setAbout(e.target.value)}
            placeholder="What is this channel for?" rows={2}
            className="w-full resize-none rounded-md border border-black/15 bg-white px-3 py-2 text-sm text-black placeholder-black/30 outline-none focus:border-black/40 dark:border-white/15 dark:bg-[#222] dark:text-white dark:placeholder-white/30 dark:focus:border-white/40"
          />
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-black/10 px-5 py-3.5 dark:border-white/10">
        <button type="button" onClick={onCancel}
          className="rounded-md px-4 py-2 text-sm text-black/50 transition-colors hover:bg-black/5 hover:text-black dark:text-white/50 dark:hover:bg-white/5 dark:hover:text-white">
          Cancel
        </button>
        <button type="button" onClick={onNext} disabled={!name.trim()}
          className="flex items-center gap-1.5 rounded-md bg-black px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-black/80 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-black dark:hover:bg-white/90">
          {channelType === "workflow"
            ? <><span>Next</span><ChevronRight className="h-3.5 w-3.5" /></>
            : "Create channel"}
        </button>
      </div>
    </>
  );
}

/* ── Step 2: model picker ───────────────────────────────────────────────── */

function ModelCard({ preset, selected, onSelect }: { preset: ModelPreset; selected: boolean; onSelect: () => void }) {
  return (
    <button type="button" onClick={onSelect}
      className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${
        selected
          ? "border-violet-500 bg-violet-50 dark:border-violet-400 dark:bg-violet-900/20"
          : "border-black/10 hover:border-black/20 hover:bg-black/3 dark:border-white/10 dark:hover:border-white/20 dark:hover:bg-white/5"
      }`}>
      <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${selected ? "bg-violet-100 dark:bg-violet-800/50" : "bg-black/5 dark:bg-white/10"}`}>
        <Bot className={`h-4 w-4 ${selected ? "text-violet-600 dark:text-violet-400" : "text-black/40 dark:text-white/40"}`} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-semibold text-black dark:text-white">{preset.name}</div>
        <div className="text-[10px] text-black/40 dark:text-white/40">{preset.description}</div>
      </div>
      <div className="shrink-0">
        <span className="rounded bg-black/5 px-1.5 py-0.5 text-[10px] font-medium text-black/50 dark:bg-white/10 dark:text-white/50">
          {preset.provider}
        </span>
      </div>
      <div className={`h-3.5 w-3.5 shrink-0 rounded-full border-2 ${selected ? "border-violet-500 bg-violet-500 dark:border-violet-400 dark:bg-violet-400" : "border-black/20 dark:border-white/20"}`} />
    </button>
  );
}

interface Step2Props {
  selectedModel: ModelPreset | null;
  setSelectedModel: (v: ModelPreset | null) => void;
  onBack: () => void;
  onNext: () => void;
  submitting: boolean;
  error: string | null;
}

function Step2({ selectedModel, setSelectedModel, onBack, onNext, submitting, error }: Step2Props) {
  return (
    <>
      <div className="space-y-3 p-5">
        <div className="flex items-start gap-2.5 rounded-lg bg-violet-50 px-3 py-2.5 dark:bg-violet-900/20">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-violet-600 dark:text-violet-400" />
          <p className="text-xs text-violet-800 dark:text-violet-200">
            Pick an agent to participate in this channel. API keys are provided automatically by the relay.
          </p>
        </div>

        <div className="space-y-1.5">
          {AI_MODELS.map((preset) => (
            <ModelCard key={preset.id} preset={preset}
              selected={selectedModel?.id === preset.id}
              onSelect={() => setSelectedModel(selectedModel?.id === preset.id ? null : preset)}
            />
          ))}
        </div>

        <button type="button" onClick={() => setSelectedModel(null)}
          className={`w-full rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
            selectedModel === null
              ? "border-black/30 bg-black/5 dark:border-white/30 dark:bg-white/10"
              : "border-black/10 text-black/40 hover:border-black/20 hover:text-black/60 dark:border-white/10 dark:text-white/40 dark:hover:text-white/60"
          }`}>
          <span className="font-medium text-black dark:text-white">Skip for now</span>
          <span className="ml-1.5 text-black/40 dark:text-white/40">— set up an agent later</span>
        </button>

        {error && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-900/20 dark:text-red-400">{error}</p>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-black/10 px-5 py-3.5 dark:border-white/10">
        <button type="button" onClick={onBack} disabled={submitting}
          className="flex items-center gap-1 rounded-md px-3 py-2 text-sm text-black/50 transition-colors hover:bg-black/5 hover:text-black dark:text-white/50 dark:hover:bg-white/5 dark:hover:text-white">
          <ChevronLeft className="h-3.5 w-3.5" /> Back
        </button>
        <button type="button" onClick={onNext} disabled={submitting}
          className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-black/80 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-black dark:hover:bg-white/90">
          {submitting ? "Creating…" : "Create channel"}
        </button>
      </div>
    </>
  );
}

/* ── Main dialog ────────────────────────────────────────────────────────── */

export function CreateChannelDialog({ onClose }: Props) {
  const { connection, identity } = useRelay();

  // Step 1
  const [name, setName] = useState("");
  const [channelType, setChannelType] = useState<ChannelType>("stream");
  const [isPrivate, setIsPrivate] = useState(false);
  const [about, setAbout] = useState("");

  // Step 2
  const [selectedModel, setSelectedModel] = useState<ModelPreset | null>(null);

  // UI state
  const [step, setStep] = useState<1 | 2>(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totalSteps = channelType === "workflow" ? 2 : 1;

  function handleStep1Next() {
    if (!name.trim()) return;
    if (channelType === "workflow") { setStep(2); } else { void handleSubmit(); }
  }

  async function handleSubmit() {
    if (!connection || !identity) { setError("Not connected to relay."); return; }
    const signFn = getSignFn();
    if (!signFn) { setError("No signing key available. Please log in again."); return; }

    setSubmitting(true);
    setError(null);

    try {
      const tags: string[][] = [
        ["name", name.trim()],
        ["channel_type", channelType],
        ["visibility", isPrivate ? "private" : "open"],
      ];
      if (about.trim()) tags.push(["about", about.trim()]);
      if (channelType === "workflow" && selectedModel) {
        tags.push(["model", selectedModel.id]);
        if (selectedModel.defaultModel) {
          tags.push(["agent_config", "MODEL_NAME", selectedModel.defaultModel]);
        }
      }

      const now = Math.floor(Date.now() / 1000);
      const signed = await signFn({ kind: KIND_CREATE_GROUP, created_at: now, tags, content: "" });
      connection.publish(signed);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create channel.");
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm dark:bg-black/60"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-md rounded-xl bg-white shadow-xl dark:bg-[#1E1E1E]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-black/10 px-5 py-4 dark:border-white/10">
          <div>
            <h2 className="text-sm font-semibold text-black dark:text-white">
              {step === 1 ? "New channel" : `Connect an agent`}
            </h2>
            {totalSteps > 1 && (
              <p className="mt-0.5 text-[11px] text-black/40 dark:text-white/40">
                Step {step} of {totalSteps}
              </p>
            )}
          </div>
          <button type="button" onClick={onClose} aria-label="Close"
            className="rounded p-1 text-black/30 transition-colors hover:bg-black/10 hover:text-black/60 dark:text-white/30 dark:hover:bg-white/10 dark:hover:text-white/60">
            <X className="h-4 w-4" />
          </button>
        </div>

        {step === 1 && (
          <Step1
            name={name} setName={setName}
            channelType={channelType} setChannelType={(v) => { setChannelType(v); setSelectedModel(null); }}
            isPrivate={isPrivate} setIsPrivate={setIsPrivate}
            about={about} setAbout={setAbout}
            onApplyTemplate={(t) => {
              setName(t.name);
              setAbout(t.about);
              setChannelType(t.channelType);
              setIsPrivate(t.isPrivate);
              setSelectedModel(
                t.model ? (AI_MODELS.find((m) => m.name === t.model) ?? null) : null,
              );
            }}
            onCancel={onClose} onNext={handleStep1Next}
          />
        )}
        {step === 2 && (
          <Step2
            selectedModel={selectedModel} setSelectedModel={setSelectedModel}
            onBack={() => setStep(1)} onNext={handleSubmit}
            submitting={submitting} error={error}
          />
        )}
      </div>
    </div>
  );
}
