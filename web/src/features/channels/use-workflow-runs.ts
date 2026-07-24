/**
 * Subscribe to workflow run-status events (kinds 46001–46012) for a channel.
 *
 * The relay emits kind:46001 (triggered) when a workflow run starts and
 * kind:46005 (completed) / kind:46006 (failed) when it finishes. These are
 * stored in the channel's event store and fan-out to all live subscribers, so
 * this hook's run log populates in real time without polling.
 *
 * Run state machine (per run ID):
 *   46001 triggered → 46002 step_started → 46003 step_completed
 *                   → 46004 step_failed
 *                   → 46005 completed
 *                   → 46006 failed
 *                   → 46007 cancelled
 *                   → 46010 approval_requested → 46011 approved / 46012 denied
 */

import { useEffect, useState, useCallback } from "react";
import { useRelay } from "@/shared/context/relay-context";
import { getSignFn } from "@/shared/lib/identity";

export const KIND_WORKFLOW_TRIGGER = 46020;
export const KIND_WORKFLOW_TRIGGERED = 46001;
export const KIND_WORKFLOW_STEP_STARTED = 46002;
export const KIND_WORKFLOW_STEP_COMPLETED = 46003;
export const KIND_WORKFLOW_STEP_FAILED = 46004;
export const KIND_WORKFLOW_COMPLETED = 46005;
export const KIND_WORKFLOW_FAILED = 46006;
export const KIND_WORKFLOW_CANCELLED = 46007;
export const KIND_WORKFLOW_APPROVAL_REQUESTED = 46010;
/** Status events emitted by the relay when an approval is resolved. */
export const KIND_WORKFLOW_APPROVAL_GRANTED = 46011;
export const KIND_WORKFLOW_APPROVAL_DENIED = 46012;
/** Command kinds sent by the user to grant or deny a pending approval. */
export const KIND_APPROVAL_GRANT = 46030;
export const KIND_APPROVAL_DENY = 46031;

export type WorkflowRunStatus =
  | "triggered"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "approval_required";

export interface WorkflowRun {
  /** Run ID — from the `run` tag or the triggering event's `d` tag. */
  runId: string;
  /** Workflow UUID that was triggered. */
  workflowId: string;
  status: WorkflowRunStatus;
  startedAt: number;
  updatedAt: number;
  /** Step currently being executed, if available. */
  currentStep?: string;
  /** Error message on failure. */
  errorMessage?: string;
  /** Approval token (for approval_required state). */
  approvalToken?: string;
}

const RUN_STATUS_KINDS = [
  KIND_WORKFLOW_TRIGGERED,
  KIND_WORKFLOW_STEP_STARTED,
  KIND_WORKFLOW_STEP_COMPLETED,
  KIND_WORKFLOW_STEP_FAILED,
  KIND_WORKFLOW_COMPLETED,
  KIND_WORKFLOW_FAILED,
  KIND_WORKFLOW_CANCELLED,
  KIND_WORKFLOW_APPROVAL_REQUESTED,
  KIND_WORKFLOW_APPROVAL_GRANTED,
  KIND_WORKFLOW_APPROVAL_DENIED,
];

function kindToStatus(kind: number): WorkflowRunStatus {
  switch (kind) {
    case KIND_WORKFLOW_TRIGGERED:
      return "triggered";
    case KIND_WORKFLOW_STEP_STARTED:
    case KIND_WORKFLOW_STEP_COMPLETED:
    case KIND_WORKFLOW_STEP_FAILED:
      return "running";
    case KIND_WORKFLOW_COMPLETED:
    case KIND_WORKFLOW_APPROVAL_GRANTED:
    case KIND_WORKFLOW_APPROVAL_DENIED:
      return "completed";
    case KIND_WORKFLOW_FAILED:
      return "failed";
    case KIND_WORKFLOW_CANCELLED:
      return "cancelled";
    case KIND_WORKFLOW_APPROVAL_REQUESTED:
      return "approval_required";
    default:
      return "running";
  }
}

export function useWorkflowRuns(groupId: string | null): {
  runs: WorkflowRun[];
  triggerRun: (workflowId: string) => Promise<void>;
  approveRun: (runId: string, approved: boolean) => Promise<void>;
  error: string | null;
} {
  const { connection, connectionState } = useRelay();
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!connection || connectionState !== "ready" || !groupId) return;

    setRuns([]);

    // Run state machine: keyed by runId. Later events update status in-place.
    const runMap = new Map<string, WorkflowRun>();
    const now = Math.floor(Date.now() / 1000);

    function applyEvent(ev: { kind: number; id: string; tags: string[][]; content: string; created_at: number }) {
      const runId =
        ev.tags.find((t) => t[0] === "run")?.[1] ??
        ev.tags.find((t) => t[0] === "d")?.[1] ??
        ev.id;
      const workflowId =
        ev.tags.find((t) => t[0] === "workflow")?.[1] ??
        ev.tags.find((t) => t[0] === "d")?.[1] ??
        "";

      const existing = runMap.get(runId);
      const status = kindToStatus(ev.kind);

      const updated: WorkflowRun = existing
        ? {
            ...existing,
            status,
            updatedAt: ev.created_at,
            currentStep:
              ev.kind === KIND_WORKFLOW_STEP_STARTED
                ? (ev.tags.find((t) => t[0] === "step")?.[1] ?? existing.currentStep)
                : existing.currentStep,
            errorMessage:
              ev.kind === KIND_WORKFLOW_FAILED || ev.kind === KIND_WORKFLOW_STEP_FAILED
                ? (ev.content || existing.errorMessage)
                : existing.errorMessage,
            approvalToken:
              ev.kind === KIND_WORKFLOW_APPROVAL_REQUESTED
                ? (ev.tags.find((t) => t[0] === "token")?.[1] ?? existing.approvalToken)
                : existing.approvalToken,
          }
        : {
            runId,
            workflowId,
            status,
            startedAt: ev.created_at,
            updatedAt: ev.created_at,
          };

      runMap.set(runId, updated);
      setRuns(Array.from(runMap.values()).sort((a, b) => b.startedAt - a.startedAt));
    }

    // Phase 1: fetch historical run events (up to 500 across all time).
    // Unsubscribes after EOSE so the relay doesn't keep it as a live filter.
    const histUnsub = connection.subscribe(
      { kinds: RUN_STATUS_KINDS, "#h": [groupId], until: now, limit: 500 },
      applyEvent,
      () => histUnsub(),
    );

    // Phase 2: live subscription for run events from this moment forward.
    const liveUnsub = connection.subscribe(
      { kinds: RUN_STATUS_KINDS, "#h": [groupId], since: now },
      applyEvent,
    );

    return () => {
      histUnsub();
      liveUnsub();
    };
  }, [connection, connectionState, groupId]);

  const triggerRun = useCallback(
    async (workflowId: string) => {
      if (!connection) { setError("Not connected to relay."); return; }
      const signFn = getSignFn();
      if (!signFn) { setError("No signing key available."); return; }

      try {
        const signed = await signFn({
          kind: KIND_WORKFLOW_TRIGGER,
          created_at: Math.floor(Date.now() / 1000),
          tags: [["d", workflowId]],
          content: "{}",
        });
        connection.publish(signed);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to trigger workflow.");
      }
    },
    [connection],
  );

  /**
   * Submit an approval decision for a pending run.
   *
   * The relay command handler (kind:46030 = grant, kind:46031 = deny) looks up
   * the approval record by token hash via the `d` tag. The token hash is the
   * `approvalToken` field on the WorkflowRun, populated from the `token` tag on
   * the kind:46010 (approval_requested) event emitted by the relay.
   *
   * @param approvalToken  The token hash hex string from the WorkflowRun.
   * @param approved       true → kind:46030 (grant), false → kind:46031 (deny).
   */
  const approveRun = useCallback(
    async (approvalToken: string, approved: boolean) => {
      if (!connection) { setError("Not connected to relay."); return; }
      const signFn = getSignFn();
      if (!signFn) { setError("No signing key available."); return; }

      try {
        // 46030 = KIND_APPROVAL_GRANT, 46031 = KIND_APPROVAL_DENY
        const kind = approved ? KIND_APPROVAL_GRANT : KIND_APPROVAL_DENY;
        const signed = await signFn({
          kind,
          created_at: Math.floor(Date.now() / 1000),
          // The relay looks up the approval record by stored token hash in the d tag.
          tags: [["d", approvalToken]],
          content: "",
        });
        connection.publish(signed);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to submit approval.");
      }
    },
    [connection],
  );

  return { runs, triggerRun, approveRun, error };
}
