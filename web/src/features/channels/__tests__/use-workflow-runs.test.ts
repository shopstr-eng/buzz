/**
 * Tests for the useWorkflowRuns hook — focusing on the delete-button
 * unblocking behaviour.
 *
 * The WorkflowList component disables the Delete button while
 *   `wfRuns.some(r => r.status === "triggered" || r.status === "running")`
 * is true.  These tests verify that when the relay emits a terminal event
 * (kind 46005 completed / 46006 failed / 46007 cancelled) the hook updates
 * the run's status reactively — no page refresh required — so the flag
 * becomes false and the button re-enables.
 */

import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── mocks ──────────────────────────────────────────────────────────────────

vi.mock("@/shared/context/relay-context", () => ({
  useRelay: vi.fn(),
}));

vi.mock("@/shared/lib/identity", () => ({
  getSignFn: vi.fn(),
}));

import { useRelay } from "@/shared/context/relay-context";
import { useWorkflowRuns } from "../use-workflow-runs";
import {
  KIND_WORKFLOW_TRIGGERED,
  KIND_WORKFLOW_STEP_STARTED,
  KIND_WORKFLOW_COMPLETED,
  KIND_WORKFLOW_FAILED,
  KIND_WORKFLOW_CANCELLED,
} from "../use-workflow-runs";
import type { NostrEvent } from "@/shared/lib/relay-connection";

// ── helpers ────────────────────────────────────────────────────────────────

let _eventSeq = 0;
function makeRunEvent(overrides: {
  kind: number;
  runId: string;
  workflowId: string;
  created_at?: number;
  content?: string;
  extraTags?: string[][];
}): NostrEvent {
  _eventSeq += 1;
  return {
    id: `ev-${_eventSeq}`,
    pubkey: "aa".repeat(32),
    kind: overrides.kind,
    created_at: overrides.created_at ?? _eventSeq * 10,
    tags: [
      ["h", "group-1"],
      ["run", overrides.runId],
      ["workflow", overrides.workflowId],
      ...(overrides.extraTags ?? []),
    ],
    content: overrides.content ?? "",
    sig: "sig".repeat(21) + "si",
  };
}

function makeMockConnection() {
  const subscribeCalls: Array<{ onEvent: (ev: NostrEvent) => void }> = [];
  const unsubscribe = vi.fn();
  const publish = vi.fn();

  const connection = {
    subscribe: vi.fn((_filter, onEvent) => {
      subscribeCalls.push({ onEvent });
      return unsubscribe;
    }),
    publish,
  };

  return { connection, subscribeCalls, publish, unsubscribe };
}

function mockRelayReady(connection: unknown) {
  vi.mocked(useRelay).mockReturnValue({
    connection: connection as never,
    connectionState: "ready",
    identity: null,
    loginWithExtension: vi.fn(),
    loginWithKey: vi.fn(),
    logout: vi.fn(),
  });
}

/** Returns true when any run for the given workflowId has an active status. */
function hasActiveRun(
  runs: ReturnType<typeof useWorkflowRuns>["runs"],
  workflowId: string,
): boolean {
  return runs
    .filter((r) => r.workflowId === workflowId)
    .some((r) => r.status === "triggered" || r.status === "running");
}

// ── tests ──────────────────────────────────────────────────────────────────

describe("useWorkflowRuns – delete button unblocks after run finishes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _eventSeq = 0;
  });

  it("hasActiveRun is true while triggered, false after completed (kind 46005)", () => {
    const { connection, subscribeCalls } = makeMockConnection();
    mockRelayReady(connection);

    const { result } = renderHook(() => useWorkflowRuns("group-1"));
    expect(subscribeCalls).toHaveLength(1);
    const { onEvent } = subscribeCalls[0];

    // 1. Run starts — relay emits kind:46001 (triggered)
    act(() => {
      onEvent(makeRunEvent({ kind: KIND_WORKFLOW_TRIGGERED, runId: "run-1", workflowId: "wf-a" }));
    });

    expect(result.current.runs).toHaveLength(1);
    expect(result.current.runs[0].status).toBe("triggered");
    expect(hasActiveRun(result.current.runs, "wf-a")).toBe(true);

    // 2. Run finishes — relay emits kind:46005 (completed)
    act(() => {
      onEvent(makeRunEvent({ kind: KIND_WORKFLOW_COMPLETED, runId: "run-1", workflowId: "wf-a" }));
    });

    // Status must update in-place; button should unblock without any page refresh.
    expect(result.current.runs).toHaveLength(1);
    expect(result.current.runs[0].status).toBe("completed");
    expect(hasActiveRun(result.current.runs, "wf-a")).toBe(false);
  });

  it("hasActiveRun is true while running (step_started), false after failed (kind 46006)", () => {
    const { connection, subscribeCalls } = makeMockConnection();
    mockRelayReady(connection);

    const { result } = renderHook(() => useWorkflowRuns("group-1"));
    const { onEvent } = subscribeCalls[0];

    act(() => {
      onEvent(makeRunEvent({ kind: KIND_WORKFLOW_TRIGGERED, runId: "run-2", workflowId: "wf-b" }));
    });
    act(() => {
      onEvent(makeRunEvent({
        kind: KIND_WORKFLOW_STEP_STARTED,
        runId: "run-2",
        workflowId: "wf-b",
        extraTags: [["step", "notify"]],
      }));
    });

    expect(result.current.runs[0].status).toBe("running");
    expect(hasActiveRun(result.current.runs, "wf-b")).toBe(true);

    act(() => {
      onEvent(makeRunEvent({
        kind: KIND_WORKFLOW_FAILED,
        runId: "run-2",
        workflowId: "wf-b",
        content: "step timed out",
      }));
    });

    expect(result.current.runs[0].status).toBe("failed");
    expect(hasActiveRun(result.current.runs, "wf-b")).toBe(false);
  });

  it("hasActiveRun is true while triggered, false after cancelled (kind 46007)", () => {
    const { connection, subscribeCalls } = makeMockConnection();
    mockRelayReady(connection);

    const { result } = renderHook(() => useWorkflowRuns("group-1"));
    const { onEvent } = subscribeCalls[0];

    act(() => {
      onEvent(makeRunEvent({ kind: KIND_WORKFLOW_TRIGGERED, runId: "run-3", workflowId: "wf-c" }));
    });

    expect(hasActiveRun(result.current.runs, "wf-c")).toBe(true);

    act(() => {
      onEvent(makeRunEvent({ kind: KIND_WORKFLOW_CANCELLED, runId: "run-3", workflowId: "wf-c" }));
    });

    expect(result.current.runs[0].status).toBe("cancelled");
    expect(hasActiveRun(result.current.runs, "wf-c")).toBe(false);
  });

  it("only the finished run transitions; an independently active run keeps hasActiveRun true", () => {
    const { connection, subscribeCalls } = makeMockConnection();
    mockRelayReady(connection);

    const { result } = renderHook(() => useWorkflowRuns("group-1"));
    const { onEvent } = subscribeCalls[0];

    // Two runs for the same workflow — both start active.
    act(() => {
      onEvent(makeRunEvent({ kind: KIND_WORKFLOW_TRIGGERED, runId: "run-4", workflowId: "wf-d" }));
      onEvent(makeRunEvent({ kind: KIND_WORKFLOW_TRIGGERED, runId: "run-5", workflowId: "wf-d" }));
    });

    expect(hasActiveRun(result.current.runs, "wf-d")).toBe(true);

    // First run completes, second still running.
    act(() => {
      onEvent(makeRunEvent({ kind: KIND_WORKFLOW_COMPLETED, runId: "run-4", workflowId: "wf-d" }));
    });

    // hasActiveRun must still be true because run-5 is still triggered.
    expect(hasActiveRun(result.current.runs, "wf-d")).toBe(true);

    // Second run completes.
    act(() => {
      onEvent(makeRunEvent({ kind: KIND_WORKFLOW_COMPLETED, runId: "run-5", workflowId: "wf-d" }));
    });

    expect(hasActiveRun(result.current.runs, "wf-d")).toBe(false);
  });

  it("a run that was never seen before is treated as active when its first event is triggered", () => {
    const { connection, subscribeCalls } = makeMockConnection();
    mockRelayReady(connection);

    const { result } = renderHook(() => useWorkflowRuns("group-1"));
    const { onEvent } = subscribeCalls[0];

    // Single triggered event — should register as an active run.
    act(() => {
      onEvent(makeRunEvent({ kind: KIND_WORKFLOW_TRIGGERED, runId: "run-6", workflowId: "wf-e" }));
    });

    expect(result.current.runs).toHaveLength(1);
    expect(result.current.runs[0].status).toBe("triggered");
    expect(hasActiveRun(result.current.runs, "wf-e")).toBe(true);

    // Terminal event for the same run — button must unblock immediately.
    act(() => {
      onEvent(makeRunEvent({ kind: KIND_WORKFLOW_COMPLETED, runId: "run-6", workflowId: "wf-e" }));
    });

    expect(result.current.runs[0].status).toBe("completed");
    expect(hasActiveRun(result.current.runs, "wf-e")).toBe(false);
  });
});
