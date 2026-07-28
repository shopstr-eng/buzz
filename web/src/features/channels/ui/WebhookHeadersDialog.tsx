/**
 * Structured editor for `call_webhook` step headers in a workflow YAML doc.
 *
 * The web workflow editor is YAML-first (deliberate parity decision), but
 * headers are fiddly as raw YAML — this dialog parses the doc, lists every
 * `call_webhook` step, and edits each step's `headers` map as key/value rows.
 * Applying re-serializes the YAML, which normalizes formatting and drops
 * comments — the dialog says so before the user commits.
 */

import { useMemo, useState } from "react";
import { X, Plus, Trash2 } from "lucide-react";
import { load as yamlLoad, dump as yamlDump } from "js-yaml";

interface HeaderRow {
  key: string;
  value: string;
}

interface StepDraft {
  /** Index into the doc's steps array. */
  index: number;
  id: string;
  rows: HeaderRow[];
}

interface WorkflowDoc {
  steps?: Array<Record<string, unknown>>;
}

function parseSteps(source: string): { doc: WorkflowDoc; steps: StepDraft[] } | { error: string } {
  let doc: unknown;
  try {
    doc = yamlLoad(source);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Invalid YAML." };
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    return { error: "Workflow YAML must be a mapping." };
  }
  const workflow = doc as WorkflowDoc;
  const steps = Array.isArray(workflow.steps) ? workflow.steps : [];
  const drafts: StepDraft[] = [];
  steps.forEach((step, index) => {
    if (!step || typeof step !== "object") return;
    if (step.action !== "call_webhook") return;
    const headers = step.headers;
    const rows: HeaderRow[] =
      headers && typeof headers === "object" && !Array.isArray(headers)
        ? Object.entries(headers as Record<string, unknown>).map(([key, value]) => ({
            key,
            value: typeof value === "string" ? value : String(value),
          }))
        : [];
    drafts.push({
      index,
      id: typeof step.id === "string" && step.id ? step.id : `step ${index + 1}`,
      rows,
    });
  });
  return { doc: workflow, steps: drafts };
}

export function WebhookHeadersDialog({
  source,
  onApply,
  onClose,
}: {
  source: string;
  onApply: (yamlText: string) => void;
  onClose: () => void;
}) {
  const parsed = useMemo(() => parseSteps(source), [source]);
  const [steps, setSteps] = useState<StepDraft[]>(
    "steps" in parsed ? parsed.steps : [],
  );
  const [error, setError] = useState<string | null>(
    "error" in parsed ? parsed.error : null,
  );

  function updateStep(index: number, rows: HeaderRow[]): void {
    setSteps((prev) => prev.map((s) => (s.index === index ? { ...s, rows } : s)));
  }

  function handleApply(): void {
    if (!("doc" in parsed)) return;
    const doc = parsed.doc;
    const nextSteps = [...(doc.steps ?? [])];
    for (const draft of steps) {
      const step = { ...nextSteps[draft.index] };
      const headers: Record<string, string> = {};
      for (const row of draft.rows) {
        const key = row.key.trim();
        if (key) headers[key] = row.value;
      }
      if (Object.keys(headers).length > 0) {
        step.headers = headers;
      } else {
        delete step.headers;
      }
      nextSteps[draft.index] = step;
    }
    try {
      onApply(yamlDump({ ...doc, steps: nextSteps }, { lineWidth: 100 }));
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to serialize YAML.");
    }
  }

  const noWebhookSteps = !error && steps.length === 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onMouseDown={onClose}>
      <div
        className="max-h-[80vh] w-[28rem] overflow-y-auto rounded-xl border border-black/10 bg-white p-4 shadow-xl dark:border-white/10 dark:bg-[#1E1E1E]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-black dark:text-white">Webhook headers</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-black/30 hover:text-black/60 dark:text-white/30 dark:hover:text-white/60"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {error && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-900/20 dark:text-red-400">
            {error}
          </p>
        )}

        {noWebhookSteps && (
          <p className="text-xs text-black/50 dark:text-white/50">
            No <code className="font-mono text-violet-700 dark:text-violet-300">call_webhook</code>{" "}
            steps in this workflow yet. Add one in the YAML, then edit its headers here.
          </p>
        )}

        {steps.map((step) => (
          <div key={step.index} className="mb-4">
            <p className="mb-1.5 text-xs font-semibold text-black/70 dark:text-white/70">
              {step.id}
            </p>
            <div className="space-y-1.5">
              {step.rows.length === 0 && (
                <p className="text-[11px] text-black/35 dark:text-white/35">No custom headers.</p>
              )}
              {step.rows.map((row, rowIndex) => (
                <div key={rowIndex} className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={row.key}
                    onChange={(e) =>
                      updateStep(
                        step.index,
                        step.rows.map((r, i) => (i === rowIndex ? { ...r, key: e.target.value } : r)),
                      )
                    }
                    placeholder="Header"
                    className="w-2/5 rounded-md border border-black/15 bg-transparent px-2 py-1 font-mono text-[11px] text-black outline-none focus:border-black/40 dark:border-white/15 dark:text-white dark:focus:border-white/40"
                  />
                  <input
                    type="text"
                    value={row.value}
                    onChange={(e) =>
                      updateStep(
                        step.index,
                        step.rows.map((r, i) => (i === rowIndex ? { ...r, value: e.target.value } : r)),
                      )
                    }
                    placeholder="Value"
                    className="flex-1 rounded-md border border-black/15 bg-transparent px-2 py-1 font-mono text-[11px] text-black outline-none focus:border-black/40 dark:border-white/15 dark:text-white dark:focus:border-white/40"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      updateStep(step.index, step.rows.filter((_, i) => i !== rowIndex))
                    }
                    aria-label="Remove header"
                    className="shrink-0 text-black/30 hover:text-red-500 dark:text-white/30 dark:hover:text-red-400"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => updateStep(step.index, [...step.rows, { key: "", value: "" }])}
                className="flex items-center gap-1 text-[11px] font-medium text-black/50 hover:text-black dark:text-white/50 dark:hover:text-white"
              >
                <Plus className="h-3 w-3" /> Add header
              </button>
            </div>
          </div>
        ))}

        {!error && !noWebhookSteps && (
          <>
            <p className="mb-3 rounded-md bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
              Applying rewrites the YAML and drops any comments/formatting.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md px-3 py-1.5 text-xs text-black/60 hover:bg-black/5 dark:text-white/60 dark:hover:bg-white/5"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleApply}
                className="rounded-md bg-black px-3 py-1.5 text-xs font-medium text-white hover:bg-black/80 dark:bg-white dark:text-black dark:hover:bg-white/90"
              >
                Apply to YAML
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
