/**
 * Workflow channel view.
 *
 * Renders a YAML editor + reference card for defining workflows, a list of
 * saved workflow definitions with "Run" buttons, and a live run log showing
 * status badges and Approve / Deny controls for approval-gated runs.
 */

import { useState } from "react";
import {
  Play,
  Save,
  Plus,
  ChevronDown,
  ChevronUp,
  CheckCircle,
  XCircle,
  Clock,
  Loader,
  AlertTriangle,
  ThumbsUp,
  ThumbsDown,
  Zap,
  BookOpen,
} from "lucide-react";
import { useWorkflows } from "../use-workflows";
import { useWorkflowRuns, type WorkflowRun, type WorkflowRunStatus } from "../use-workflow-runs";
import type { Channel } from "../types";

// ── Reference card data derived from buzz-workflow schema ──────────────────

const TRIGGER_TYPES = [
  { tag: "message_posted", desc: "Any message posted in the channel", fields: "filter? (evalexpr)" },
  { tag: "reaction_added", desc: "Emoji reaction added to a message", fields: "emoji? (specific emoji)" },
  { tag: "diff_posted", desc: "Code diff posted in the channel", fields: "filter? (evalexpr)" },
  { tag: "schedule", desc: "Recurring schedule", fields: "cron OR interval (e.g. '30m', '1h')" },
  { tag: "webhook", desc: "HTTP POST to /hooks/{id}", fields: "— (no extra fields)" },
];

const STEP_ACTIONS = [
  { tag: "send_message", fields: "text, channel?" },
  { tag: "send_dm", fields: "to, text" },
  { tag: "set_channel_topic", fields: "topic" },
  { tag: "add_reaction", fields: "emoji" },
  { tag: "call_webhook", fields: "url, method?, headers?, body?" },
  { tag: "request_approval", fields: "from, message, timeout?" },
  { tag: "delay", fields: "duration (e.g. '5m', '1h')" },
];

const EXAMPLE_YAML = `name: Alert on P1
trigger:
  on: message_posted
  filter: 'str_contains(trigger_text, "P1")'
steps:
  - id: notify
    action: send_message
    text: "🚨 P1 alert: {{trigger_text}}"
`;

// ── Status badge ───────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: WorkflowRunStatus }) {
  const cfg: Record<WorkflowRunStatus, { label: string; cls: string; Icon: React.ElementType }> = {
    triggered: {
      label: "Triggered",
      cls: "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
      Icon: Clock,
    },
    running: {
      label: "Running",
      cls: "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
      Icon: Loader,
    },
    completed: {
      label: "Completed",
      cls: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
      Icon: CheckCircle,
    },
    failed: {
      label: "Failed",
      cls: "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300",
      Icon: XCircle,
    },
    cancelled: {
      label: "Cancelled",
      cls: "bg-black/5 text-black/50 dark:bg-white/10 dark:text-white/50",
      Icon: XCircle,
    },
    approval_required: {
      label: "Awaiting approval",
      cls: "bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300",
      Icon: AlertTriangle,
    },
  };
  const { label, cls, Icon } = cfg[status];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>
      <Icon className={`h-3 w-3 ${status === "running" ? "animate-spin" : ""}`} />
      {label}
    </span>
  );
}

// ── Run row ────────────────────────────────────────────────────────────────

function RunRow({
  run,
  onApprove,
  onDeny,
}: {
  run: WorkflowRun;
  onApprove: () => void;
  onDeny: () => void;
}) {
  const date = new Date(run.startedAt * 1000);
  const timeStr = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const dateStr = date.toLocaleDateString([], { month: "short", day: "numeric" });

  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-black/8 bg-white px-3 py-2.5 dark:border-white/8 dark:bg-[#1A1A1A]">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <StatusBadge status={run.status} />
          {run.currentStep && (
            <span className="text-[11px] text-black/40 dark:text-white/40">
              step: {run.currentStep}
            </span>
          )}
        </div>
        {run.errorMessage && (
          <p className="mt-1 text-[11px] text-red-600 dark:text-red-400 line-clamp-2">
            {run.errorMessage}
          </p>
        )}
        <p className="mt-0.5 text-[10px] text-black/35 dark:text-white/35">
          {dateStr} · {timeStr} · run {run.runId.slice(0, 8)}
        </p>
      </div>

      {run.status === "approval_required" && (
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={onApprove}
            className="flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-emerald-700"
          >
            <ThumbsUp className="h-3 w-3" /> Approve
          </button>
          <button
            type="button"
            onClick={onDeny}
            className="flex items-center gap-1 rounded-md border border-black/15 px-2.5 py-1 text-xs text-black/60 transition-colors hover:bg-black/5 dark:border-white/15 dark:text-white/60 dark:hover:bg-white/5"
          >
            <ThumbsDown className="h-3 w-3" /> Deny
          </button>
        </div>
      )}
    </div>
  );
}

// ── Reference card ─────────────────────────────────────────────────────────

function ReferenceCard() {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-black/10 dark:border-white/10">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-3 py-2 text-left"
      >
        <span className="flex items-center gap-1.5 text-xs font-semibold text-black/60 dark:text-white/60">
          <BookOpen className="h-3.5 w-3.5" />
          Quick reference
        </span>
        {open ? (
          <ChevronUp className="h-3.5 w-3.5 text-black/40 dark:text-white/40" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 text-black/40 dark:text-white/40" />
        )}
      </button>

      {open && (
        <div className="border-t border-black/10 px-3 pb-3 pt-2 dark:border-white/10">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-black/40 dark:text-white/40">
            Triggers (on:)
          </p>
          <div className="mb-3 space-y-1">
            {TRIGGER_TYPES.map((t) => (
              <div key={t.tag} className="flex items-start gap-2">
                <code className="shrink-0 rounded bg-black/5 px-1 py-0.5 text-[10px] font-mono text-violet-700 dark:bg-white/10 dark:text-violet-300">
                  {t.tag}
                </code>
                <span className="text-[11px] text-black/60 dark:text-white/60">
                  {t.desc}
                  {t.fields !== "— (no extra fields)" && (
                    <span className="text-black/35 dark:text-white/35"> · {t.fields}</span>
                  )}
                </span>
              </div>
            ))}
          </div>

          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-black/40 dark:text-white/40">
            Step actions (action:)
          </p>
          <div className="space-y-1">
            {STEP_ACTIONS.map((a) => (
              <div key={a.tag} className="flex items-start gap-2">
                <code className="shrink-0 rounded bg-black/5 px-1 py-0.5 text-[10px] font-mono text-blue-700 dark:bg-white/10 dark:text-blue-300">
                  {a.tag}
                </code>
                <span className="text-[11px] text-black/60 dark:text-white/60">{a.fields}</span>
              </div>
            ))}
          </div>

          <p className="mt-2.5 text-[10px] text-black/35 dark:text-white/35">
            Step fields: <code className="font-mono">id</code> (required),{" "}
            <code className="font-mono">name?</code>,{" "}
            <code className="font-mono">if?</code> (evalexpr condition),{" "}
            <code className="font-mono">timeout_secs?</code>
          </p>
        </div>
      )}
    </div>
  );
}

// ── Editor panel ───────────────────────────────────────────────────────────

function WorkflowEditor({
  onSave,
  isSaving,
}: {
  onSave: (name: string, yaml: string, existingId?: string) => Promise<void>;
  isSaving: boolean;
}) {
  const [yaml, setYaml] = useState(EXAMPLE_YAML);
  const [error, setError] = useState<string | null>(null);

  function extractName(y: string): string {
    const m = y.match(/^name:\s*['"]?(.+?)['"]?\s*$/m);
    return m?.[1]?.trim() || "Untitled workflow";
  }

  async function handleSave() {
    const name = extractName(yaml);
    if (!yaml.trim()) { setError("Workflow YAML cannot be empty."); return; }
    try {
      setError(null);
      await onSave(name, yaml);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save workflow.");
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-black/60 dark:text-white/60">
          Workflow YAML
        </span>
        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving}
          className="flex items-center gap-1.5 rounded-md bg-black px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-black/80 disabled:opacity-40 dark:bg-white dark:text-black dark:hover:bg-white/90"
        >
          {isSaving ? (
            <Loader className="h-3 w-3 animate-spin" />
          ) : (
            <Save className="h-3 w-3" />
          )}
          Save workflow
        </button>
      </div>

      <textarea
        value={yaml}
        onChange={(e) => setYaml(e.target.value)}
        spellCheck={false}
        rows={14}
        className="w-full resize-y rounded-md border border-black/15 bg-white p-3 font-mono text-xs leading-relaxed text-black outline-none placeholder-black/25 focus:border-black/40 dark:border-white/15 dark:bg-[#111] dark:text-white dark:placeholder-white/25 dark:focus:border-white/40"
        placeholder={EXAMPLE_YAML}
      />

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-900/20 dark:text-red-400">
          {error}
        </p>
      )}

      <ReferenceCard />
    </div>
  );
}

// ── Saved workflows list ───────────────────────────────────────────────────

function WorkflowList({
  workflows,
  isLoading,
  runs,
  onRun,
  onApprove,
  onDeny,
}: {
  workflows: ReturnType<typeof useWorkflows>["workflows"];
  isLoading: boolean;
  runs: WorkflowRun[];
  onRun: (workflowId: string) => void;
  /** Called with the approval token hash (not the run ID). */
  onApprove: (approvalToken: string) => void;
  onDeny: (approvalToken: string) => void;
}) {
  const [expandedRuns, setExpandedRuns] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[60, 80, 50].map((w) => (
          <div
            key={w}
            className="h-12 animate-pulse rounded-lg bg-black/8 dark:bg-white/8"
            style={{ width: `${w}%` }}
          />
        ))}
      </div>
    );
  }

  if (workflows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-black/20 p-6 text-center dark:border-white/20">
        <Zap className="mx-auto mb-2 h-6 w-6 text-black/20 dark:text-white/20" />
        <p className="text-sm text-black/40 dark:text-white/40">
          No workflows yet — write one above and click Save.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {workflows.map((wf) => {
        const wfRuns = runs.filter((r) => r.workflowId === wf.workflowId);
        const latestRun = wfRuns[0];
        const isExpanded = expandedRuns === wf.workflowId;

        return (
          <div
            key={wf.workflowId}
            className="overflow-hidden rounded-lg border border-black/10 dark:border-white/10"
          >
            {/* Workflow row */}
            <div className="flex items-center gap-2 bg-black/2 px-3 py-2 dark:bg-white/3">
              <Zap className="h-3.5 w-3.5 shrink-0 text-violet-500 dark:text-violet-400" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-black dark:text-white">
                {wf.name}
              </span>

              {latestRun && (
                <StatusBadge status={latestRun.status} />
              )}

              <button
                type="button"
                onClick={() =>
                  setExpandedRuns((prev) =>
                    prev === wf.workflowId ? null : wf.workflowId,
                  )
                }
                className="shrink-0 text-[11px] text-black/40 hover:text-black/70 dark:text-white/40 dark:hover:text-white/70"
                title={isExpanded ? "Hide runs" : "Show runs"}
              >
                {isExpanded ? (
                  <ChevronUp className="h-3.5 w-3.5" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" />
                )}
              </button>

              <button
                type="button"
                onClick={() => onRun(wf.workflowId)}
                className="flex shrink-0 items-center gap-1 rounded-md bg-violet-600 px-2.5 py-1 text-[11px] font-medium text-white transition-colors hover:bg-violet-700"
              >
                <Play className="h-3 w-3" />
                Run
              </button>
            </div>

            {/* Run log */}
            {isExpanded && (
              <div className="space-y-1.5 bg-white/50 p-2.5 dark:bg-[#111]/50">
                {wfRuns.length === 0 ? (
                  <p className="text-center text-[11px] text-black/35 dark:text-white/35 py-2">
                    No runs yet.
                  </p>
                ) : (
                  wfRuns.slice(0, 20).map((run) => (
                    <RunRow
                      key={run.runId}
                      run={run}
                      onApprove={() => run.approvalToken && onApprove(run.approvalToken)}
                      onDeny={() => run.approvalToken && onDeny(run.approvalToken)}
                    />
                  ))
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export function WorkflowChannelView({ channel }: { channel: Channel }) {
  const { workflows, isLoading, publishWorkflow } = useWorkflows(channel.groupId);
  const { runs, triggerRun, approveRun, error: runError } = useWorkflowRuns(channel.groupId);

  const [isSaving, setIsSaving] = useState(false);
  const [tab, setTab] = useState<"editor" | "workflows">("workflows");

  async function handleSave(name: string, yaml: string, existingId?: string) {
    setIsSaving(true);
    try {
      await publishWorkflow(name, yaml, existingId);
      setTab("workflows");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-white dark:bg-[#111111]">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-2 border-b border-black/10 px-4 py-3 dark:border-white/10">
        <Zap className="h-4 w-4 text-violet-500 dark:text-violet-400" />
        <h1 className="text-sm font-semibold text-black dark:text-white">{channel.name}</h1>
        {channel.model && (
          <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-medium text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
            {channel.model.split("-")[0]}
          </span>
        )}
        {channel.about && (
          <>
            <div className="h-3.5 w-px bg-black/15 dark:bg-white/15" />
            <p className="min-w-0 truncate text-xs text-black/50 dark:text-white/50">
              {channel.about}
            </p>
          </>
        )}
      </div>

      {/* Tab bar */}
      <div className="flex shrink-0 border-b border-black/10 dark:border-white/10">
        <button
          type="button"
          onClick={() => setTab("workflows")}
          className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium transition-colors ${
            tab === "workflows"
              ? "border-b-2 border-black text-black dark:border-white dark:text-white"
              : "text-black/40 hover:text-black/70 dark:text-white/40 dark:hover:text-white/70"
          }`}
        >
          <Zap className="h-3.5 w-3.5" />
          Workflows
        </button>
        <button
          type="button"
          onClick={() => setTab("editor")}
          className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium transition-colors ${
            tab === "editor"
              ? "border-b-2 border-black text-black dark:border-white dark:text-white"
              : "text-black/40 hover:text-black/70 dark:text-white/40 dark:hover:text-white/70"
          }`}
        >
          <Plus className="h-3.5 w-3.5" />
          New workflow
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4">
        {runError && (
          <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-900/20 dark:text-red-400">
            {runError}
          </div>
        )}

        {tab === "editor" ? (
          <WorkflowEditor onSave={handleSave} isSaving={isSaving} />
        ) : (
          <WorkflowList
            workflows={workflows}
            isLoading={isLoading}
            runs={runs}
            onRun={triggerRun}
            onApprove={(token) => approveRun(token, true)}
            onDeny={(token) => approveRun(token, false)}
          />
        )}
      </div>
    </div>
  );
}
