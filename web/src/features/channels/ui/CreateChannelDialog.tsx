/**
 * Two-step modal for creating a new channel.
 *
 * Step 1 — Basic info: name, type (stream/forum/workflow), visibility, about.
 * Step 2 — AI model (workflow channels only): pick a model or skip.
 *
 * Publishes a kind:9007 (NIP-29 create-group) event via the relay connection.
 * Workflow channels include a ["model", modelId] tag when a model is selected.
 */

import { useState } from "react";
import { X, Hash, MessageSquare, Zap, Globe, Lock, Bot, ChevronRight, ChevronLeft, Sparkles } from "lucide-react";
import { useRelay } from "@/shared/context/relay-context";
import { getSignFn } from "@/shared/lib/identity";
import { KIND_CREATE_GROUP, AI_MODELS, type ChannelType, type ModelPreset } from "../types";

interface Props {
  onClose: () => void;
}

const CHANNEL_TYPES: { value: ChannelType; label: string; desc: string; Icon: React.ElementType }[] = [
  { value: "stream", label: "Stream", desc: "Real-time chat", Icon: Hash },
  { value: "forum", label: "Forum", desc: "Threaded discussion", Icon: MessageSquare },
  { value: "workflow", label: "Workflow", desc: "AI-assisted tasks", Icon: Zap },
];

/* ── Step 1: Basic info ─────────────────────────────────────────────────── */

interface Step1Props {
  name: string;
  setName: (v: string) => void;
  channelType: ChannelType;
  setChannelType: (v: ChannelType) => void;
  isPrivate: boolean;
  setIsPrivate: (v: boolean) => void;
  about: string;
  setAbout: (v: string) => void;
  onCancel: () => void;
  onNext: () => void;
}

function Step1({
  name, setName, channelType, setChannelType, isPrivate, setIsPrivate,
  about, setAbout, onCancel, onNext,
}: Step1Props) {
  return (
    <>
      <div className="space-y-4 p-5">
        {/* Channel name */}
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-black/60 dark:text-white/60">
            Channel name <span className="text-red-500">*</span>
          </label>
          <input
            autoFocus
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. general"
            className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm text-black placeholder-black/30 outline-none focus:border-black/40 focus:ring-0 dark:border-white/15 dark:bg-[#222] dark:text-white dark:placeholder-white/30 dark:focus:border-white/40"
          />
        </div>

        {/* Channel type */}
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-black/60 dark:text-white/60">
            Type
          </label>
          <div className="grid grid-cols-3 gap-2">
            {CHANNEL_TYPES.map(({ value, label, desc, Icon }) => (
              <button
                key={value}
                type="button"
                onClick={() => setChannelType(value)}
                className={`flex flex-col items-start gap-1 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                  channelType === value
                    ? "border-black/40 bg-black/5 dark:border-white/40 dark:bg-white/10"
                    : "border-black/10 hover:border-black/20 hover:bg-black/3 dark:border-white/10 dark:hover:border-white/20 dark:hover:bg-white/5"
                }`}
              >
                <Icon className={`h-4 w-4 ${
                  channelType === value
                    ? value === "workflow" ? "text-violet-600 dark:text-violet-400" : "text-black dark:text-white"
                    : "text-black/40 dark:text-white/40"
                }`} />
                <span className="text-xs font-medium text-black dark:text-white">{label}</span>
                <span className="text-[10px] text-black/40 dark:text-white/40 leading-tight">{desc}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Visibility */}
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-black/60 dark:text-white/60">
            Visibility
          </label>
          <div className="flex gap-2">
            {[
              { value: false, label: "Open", desc: "All members", Icon: Globe },
              { value: true, label: "Private", desc: "Invite only", Icon: Lock },
            ].map(({ value, label, desc, Icon }) => (
              <button
                key={String(value)}
                type="button"
                onClick={() => setIsPrivate(value)}
                className={`flex flex-1 items-center gap-2 rounded-lg border px-3 py-2 transition-colors ${
                  isPrivate === value
                    ? "border-black/40 bg-black/5 dark:border-white/40 dark:bg-white/10"
                    : "border-black/10 hover:border-black/20 hover:bg-black/3 dark:border-white/10 dark:hover:border-white/20"
                }`}
              >
                <Icon className="h-3.5 w-3.5 text-black/50 dark:text-white/50" />
                <div className="text-left">
                  <div className="text-xs font-medium text-black dark:text-white">{label}</div>
                  <div className="text-[10px] text-black/40 dark:text-white/40">{desc}</div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Description */}
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-black/60 dark:text-white/60">
            Description <span className="text-black/30 dark:text-white/30">(optional)</span>
          </label>
          <textarea
            value={about}
            onChange={(e) => setAbout(e.target.value)}
            placeholder="What is this channel for?"
            rows={2}
            className="w-full resize-none rounded-md border border-black/15 bg-white px-3 py-2 text-sm text-black placeholder-black/30 outline-none focus:border-black/40 dark:border-white/15 dark:bg-[#222] dark:text-white dark:placeholder-white/30 dark:focus:border-white/40"
          />
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-black/10 px-5 py-3.5 dark:border-white/10">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md px-4 py-2 text-sm text-black/50 transition-colors hover:bg-black/5 hover:text-black dark:text-white/50 dark:hover:bg-white/5 dark:hover:text-white"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={!name.trim()}
          className="flex items-center gap-1.5 rounded-md bg-black px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-black/80 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-black dark:hover:bg-white/90"
        >
          {channelType === "workflow" ? (
            <>Next <ChevronRight className="h-3.5 w-3.5" /></>
          ) : (
            "Create channel"
          )}
        </button>
      </div>
    </>
  );
}

/* ── Step 2: AI model (workflow only) ───────────────────────────────────── */

interface Step2Props {
  selectedModel: string | null;
  setSelectedModel: (v: string | null) => void;
  onBack: () => void;
  onSubmit: () => void;
  submitting: boolean;
  error: string | null;
}

function ModelCard({ preset, selected, onSelect }: {
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
      <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${
        selected ? "bg-violet-100 dark:bg-violet-800/50" : "bg-black/5 dark:bg-white/10"
      }`}>
        <Bot className={`h-4 w-4 ${selected ? "text-violet-600 dark:text-violet-400" : "text-black/40 dark:text-white/40"}`} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-semibold text-black dark:text-white">{preset.name}</div>
        <div className="text-[10px] text-black/40 dark:text-white/40">{preset.provider}</div>
      </div>
      <div className={`h-3.5 w-3.5 shrink-0 rounded-full border-2 ${
        selected
          ? "border-violet-500 bg-violet-500 dark:border-violet-400 dark:bg-violet-400"
          : "border-black/20 dark:border-white/20"
      }`} />
    </button>
  );
}

function Step2({ selectedModel, setSelectedModel, onBack, onSubmit, submitting, error }: Step2Props) {
  return (
    <>
      <div className="space-y-3 p-5">
        {/* Header */}
        <div className="flex items-start gap-2.5 rounded-lg bg-violet-50 px-3 py-2.5 dark:bg-violet-900/20">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-violet-600 dark:text-violet-400" />
          <div>
            <p className="text-xs font-semibold text-violet-800 dark:text-violet-200">
              Connect an AI model
            </p>
            <p className="mt-0.5 text-[11px] text-violet-700/70 dark:text-violet-300/70">
              The model will participate as an agent in this channel. You can change this later.
            </p>
          </div>
        </div>

        {/* Model cards */}
        <div className="space-y-1.5">
          {AI_MODELS.map((preset) => (
            <ModelCard
              key={preset.id}
              preset={preset}
              selected={selectedModel === preset.id}
              onSelect={() => setSelectedModel(selectedModel === preset.id ? null : preset.id)}
            />
          ))}
        </div>

        {/* Skip option */}
        <button
          type="button"
          onClick={() => setSelectedModel(null)}
          className={`w-full rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
            selectedModel === null
              ? "border-black/30 bg-black/5 dark:border-white/30 dark:bg-white/10"
              : "border-black/10 text-black/40 hover:border-black/20 hover:text-black/60 dark:border-white/10 dark:text-white/40 dark:hover:text-white/60"
          }`}
        >
          <span className="font-medium text-black dark:text-white">Skip for now</span>
          <span className="ml-1.5 text-black/40 dark:text-white/40">— set up an agent later</span>
        </button>

        {error && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-900/20 dark:text-red-400">
            {error}
          </p>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-black/10 px-5 py-3.5 dark:border-white/10">
        <button
          type="button"
          onClick={onBack}
          disabled={submitting}
          className="flex items-center gap-1 rounded-md px-3 py-2 text-sm text-black/50 transition-colors hover:bg-black/5 hover:text-black dark:text-white/50 dark:hover:bg-white/5 dark:hover:text-white"
        >
          <ChevronLeft className="h-3.5 w-3.5" /> Back
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={submitting}
          className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-black/80 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-black dark:hover:bg-white/90"
        >
          {submitting ? "Creating…" : "Create channel"}
        </button>
      </div>
    </>
  );
}

/* ── Main dialog ────────────────────────────────────────────────────────── */

export function CreateChannelDialog({ onClose }: Props) {
  const { connection, identity } = useRelay();

  // Step 1 fields
  const [name, setName] = useState("");
  const [channelType, setChannelType] = useState<ChannelType>("stream");
  const [isPrivate, setIsPrivate] = useState(false);
  const [about, setAbout] = useState("");

  // Step 2 field
  const [selectedModel, setSelectedModel] = useState<string | null>(null);

  // UI state
  const [step, setStep] = useState<1 | 2>(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleNext() {
    if (!name.trim()) return;
    if (channelType === "workflow") {
      setStep(2);
    } else {
      void handleSubmit();
    }
  }

  async function handleSubmit() {
    if (!connection || !identity) {
      setError("Not connected to relay.");
      return;
    }
    const signFn = getSignFn();
    if (!signFn) {
      setError("No signing key available. Please log in again.");
      return;
    }

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
        tags.push(["model", selectedModel]);
      }

      const now = Math.floor(Date.now() / 1000);
      const unsigned = { kind: KIND_CREATE_GROUP, created_at: now, tags, content: "" };
      const signed = await signFn(unsigned);
      connection.publish(signed);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create channel.");
      setSubmitting(false);
    }
  }

  const typeLabel = CHANNEL_TYPES.find((t) => t.value === channelType)?.label ?? "Channel";

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm dark:bg-black/60"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-md rounded-xl bg-white shadow-xl dark:bg-[#1E1E1E]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-black/10 px-5 py-4 dark:border-white/10">
          <div>
            <h2 className="text-sm font-semibold text-black dark:text-white">
              {step === 1 ? "New channel" : `New ${typeLabel.toLowerCase()} — connect AI`}
            </h2>
            {step === 2 && (
              <p className="mt-0.5 text-[11px] text-black/40 dark:text-white/40">
                Step 2 of 2
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-black/30 transition-colors hover:bg-black/10 hover:text-black/60 dark:text-white/30 dark:hover:bg-white/10 dark:hover:text-white/60"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {step === 1 ? (
          <Step1
            name={name} setName={setName}
            channelType={channelType} setChannelType={setChannelType}
            isPrivate={isPrivate} setIsPrivate={setIsPrivate}
            about={about} setAbout={setAbout}
            onCancel={onClose}
            onNext={handleNext}
          />
        ) : (
          <Step2
            selectedModel={selectedModel}
            setSelectedModel={setSelectedModel}
            onBack={() => setStep(1)}
            onSubmit={handleSubmit}
            submitting={submitting}
            error={error}
          />
        )}
      </div>
    </div>
  );
}
