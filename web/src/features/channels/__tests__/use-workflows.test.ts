/**
 * Tests for the use-workflows hook.
 *
 * Covers two key correctness properties:
 * 1. d-tag deduplication — when two events share the same workflow UUID,
 *    only the newer one is surfaced in the list (NIP-33 semantics).
 * 2. Edit flow — publishWorkflow re-uses the supplied existingId as the
 *    d-tag, so the relay can upsert instead of inserting a second copy.
 */

import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── mock useRelay ──────────────────────────────────────────────────────────
// The hook is imported before the mock is set up, so we need to mock the
// module that provides useRelay.

vi.mock("@/shared/context/relay-context", () => ({
  useRelay: vi.fn(),
}));

vi.mock("@/shared/lib/identity", () => ({
  getSignFn: vi.fn(),
}));

import { useRelay } from "@/shared/context/relay-context";
import { getSignFn } from "@/shared/lib/identity";
import { useWorkflows } from "../use-workflows";
import type { NostrEvent } from "@/shared/lib/relay-connection";

// ── helpers ────────────────────────────────────────────────────────────────

function makeWorkflowEvent(overrides: {
  workflowId: string;
  name?: string;
  content?: string;
  created_at?: number;
  pubkey?: string;
}): NostrEvent {
  return {
    id: `id-${overrides.workflowId}-${overrides.created_at ?? 1000}`,
    pubkey: overrides.pubkey ?? "aa".repeat(32),
    kind: 30620,
    created_at: overrides.created_at ?? 1000,
    tags: [
      ["h", "group-1"],
      ["d", overrides.workflowId],
      ["name", overrides.name ?? "My Workflow"],
    ],
    content: overrides.content ?? `name: ${overrides.name ?? "My Workflow"}\ntrigger:\n  on: webhook\nsteps: []`,
    sig: "sig".repeat(21) + "si",
  };
}

// Builds a mock relay connection and returns the captured subscribe callbacks
// so tests can push events in programmatically.
function makeMockConnection() {
  const subscribeCalls: Array<{
    onEvent: (ev: NostrEvent) => void;
    onEose?: () => void;
  }> = [];

  const unsubscribe = vi.fn();
  const publish = vi.fn();

  const connection = {
    subscribe: vi.fn((_filter, onEvent, onEose) => {
      subscribeCalls.push({ onEvent, onEose });
      return unsubscribe;
    }),
    publish,
  };

  return { connection, subscribeCalls, publish, unsubscribe };
}

// ── tests ──────────────────────────────────────────────────────────────────

describe("useWorkflows – d-tag deduplication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps only the newer event when two events share the same workflow UUID", async () => {
    const { connection, subscribeCalls } = makeMockConnection();

    vi.mocked(useRelay).mockReturnValue({
      connection: connection as never,
      connectionState: "ready",
      identity: null,
      loginWithExtension: vi.fn(),
      loginWithKey: vi.fn(),
      logout: vi.fn(),
    });

    const { result } = renderHook(() => useWorkflows("group-1"));

    // Should have opened one subscription.
    expect(subscribeCalls).toHaveLength(1);
    const { onEvent, onEose } = subscribeCalls[0];

    const olderEvent = makeWorkflowEvent({
      workflowId: "uuid-abc",
      name: "Old Name",
      content: "name: Old Name\ntrigger:\n  on: webhook\nsteps: []",
      created_at: 1000,
    });

    const newerEvent = makeWorkflowEvent({
      workflowId: "uuid-abc",
      name: "New Name",
      content: "name: New Name\ntrigger:\n  on: schedule\nsteps: []",
      created_at: 2000,
    });

    // Deliver older event first, then newer event.
    act(() => { onEvent(olderEvent); });
    act(() => { onEvent(newerEvent); });
    act(() => { onEose?.(); });

    expect(result.current.workflows).toHaveLength(1);
    expect(result.current.workflows[0].workflowId).toBe("uuid-abc");
    expect(result.current.workflows[0].name).toBe("New Name");
  });

  it("ignores a stale event that arrives after a newer one for the same UUID", async () => {
    const { connection, subscribeCalls } = makeMockConnection();

    vi.mocked(useRelay).mockReturnValue({
      connection: connection as never,
      connectionState: "ready",
      identity: null,
      loginWithExtension: vi.fn(),
      loginWithKey: vi.fn(),
      logout: vi.fn(),
    });

    const { result } = renderHook(() => useWorkflows("group-1"));

    const { onEvent, onEose } = subscribeCalls[0];

    const newerEvent = makeWorkflowEvent({
      workflowId: "uuid-xyz",
      name: "Edited Workflow",
      created_at: 2000,
    });

    const olderEvent = makeWorkflowEvent({
      workflowId: "uuid-xyz",
      name: "Original Workflow",
      created_at: 1000,
    });

    // Newer arrives first (e.g. relay sends out-of-order), then older.
    act(() => { onEvent(newerEvent); });
    act(() => { onEvent(olderEvent); });
    act(() => { onEose?.(); });

    // The older event must NOT displace the newer one.
    expect(result.current.workflows).toHaveLength(1);
    expect(result.current.workflows[0].name).toBe("Edited Workflow");
  });

  it("shows two separate workflows when their UUIDs differ", async () => {
    const { connection, subscribeCalls } = makeMockConnection();

    vi.mocked(useRelay).mockReturnValue({
      connection: connection as never,
      connectionState: "ready",
      identity: null,
      loginWithExtension: vi.fn(),
      loginWithKey: vi.fn(),
      logout: vi.fn(),
    });

    const { result } = renderHook(() => useWorkflows("group-1"));

    const { onEvent, onEose } = subscribeCalls[0];

    act(() => { onEvent(makeWorkflowEvent({ workflowId: "uuid-1", name: "Alpha", created_at: 1000 })); });
    act(() => { onEvent(makeWorkflowEvent({ workflowId: "uuid-2", name: "Beta",  created_at: 2000 })); });
    act(() => { onEose?.(); });

    expect(result.current.workflows).toHaveLength(2);
    const names = result.current.workflows.map((w) => w.name).sort();
    expect(names).toEqual(["Alpha", "Beta"]);
  });
});

describe("useWorkflows – edit flow (publishWorkflow re-uses existingId)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("publishes with the supplied existingId as the d-tag, not a fresh UUID", async () => {
    const { connection, subscribeCalls, publish } = makeMockConnection();

    vi.mocked(useRelay).mockReturnValue({
      connection: connection as never,
      connectionState: "ready",
      identity: null,
      loginWithExtension: vi.fn(),
      loginWithKey: vi.fn(),
      logout: vi.fn(),
    });

    const signFn = vi.fn(async (event: Record<string, unknown>) => ({
      ...event,
      id: "signed-id",
      sig: "sig".repeat(21) + "si",
      pubkey: "aa".repeat(32),
    }));

    vi.mocked(getSignFn).mockReturnValue(signFn as never);

    const { result } = renderHook(() => useWorkflows("group-1"));

    // Seed with one existing workflow.
    const { onEvent, onEose } = subscribeCalls[0];
    const existingEvent = makeWorkflowEvent({ workflowId: "stable-uuid", name: "Original", created_at: 1000 });
    act(() => { onEvent(existingEvent); });
    act(() => { onEose?.(); });

    expect(result.current.workflows).toHaveLength(1);

    // Edit the workflow — supply the same UUID.
    await act(async () => {
      await result.current.publishWorkflow(
        "Updated Name",
        "name: Updated Name\ntrigger:\n  on: webhook\nsteps: []",
        "stable-uuid", // existingId
      );
    });

    expect(publish).toHaveBeenCalledOnce();
    const publishedEvent = publish.mock.calls[0][0] as { tags: string[][] };
    const dTag = publishedEvent.tags.find(([k]) => k === "d");
    expect(dTag).toBeDefined();
    expect(dTag![1]).toBe("stable-uuid");
  });

  it("generates a fresh UUID when no existingId is supplied (new workflow)", async () => {
    const { connection, subscribeCalls, publish } = makeMockConnection();

    vi.mocked(useRelay).mockReturnValue({
      connection: connection as never,
      connectionState: "ready",
      identity: null,
      loginWithExtension: vi.fn(),
      loginWithKey: vi.fn(),
      logout: vi.fn(),
    });

    const signFn = vi.fn(async (event: Record<string, unknown>) => ({
      ...event,
      id: "signed-id-2",
      sig: "sig".repeat(21) + "si",
      pubkey: "aa".repeat(32),
    }));

    vi.mocked(getSignFn).mockReturnValue(signFn as never);

    // Stub crypto.randomUUID to return a predictable value.
    const originalRandomUUID = crypto.randomUUID.bind(crypto);
    vi.spyOn(crypto, "randomUUID").mockReturnValueOnce("fresh-uuid" as `${string}-${string}-${string}-${string}-${string}`);

    const { result } = renderHook(() => useWorkflows("group-1"));
    const { onEose } = subscribeCalls[0];
    act(() => { onEose?.(); });

    await act(async () => {
      await result.current.publishWorkflow("New Workflow", "name: New Workflow\nsteps: []");
    });

    const publishedEvent = publish.mock.calls[0][0] as { tags: string[][] };
    const dTag = publishedEvent.tags.find(([k]) => k === "d");
    expect(dTag![1]).toBe("fresh-uuid");

    vi.mocked(crypto.randomUUID).mockRestore?.();
    // Restore (no-op if spyOn already handles cleanup via vi.clearAllMocks on next test).
    void originalRandomUUID;
  });

  it("after an edit event arrives, the workflow list still shows only one entry for that UUID", async () => {
    const { connection, subscribeCalls } = makeMockConnection();

    vi.mocked(useRelay).mockReturnValue({
      connection: connection as never,
      connectionState: "ready",
      identity: null,
      loginWithExtension: vi.fn(),
      loginWithKey: vi.fn(),
      logout: vi.fn(),
    });

    const { result } = renderHook(() => useWorkflows("group-1"));

    const { onEvent, onEose } = subscribeCalls[0];

    // Simulate the relay sending the original event followed by a replacement
    // (same d-tag, newer timestamp) — exactly what happens after an edit save.
    const original = makeWorkflowEvent({ workflowId: "wf-id", name: "Original", created_at: 1_000 });
    const replacement = makeWorkflowEvent({ workflowId: "wf-id", name: "Edited",   created_at: 2_000 });

    act(() => { onEvent(original); });
    act(() => { onEvent(replacement); });
    act(() => { onEose?.(); });

    // Must be exactly one entry — no duplicates.
    expect(result.current.workflows).toHaveLength(1);
    expect(result.current.workflows[0].name).toBe("Edited");
    expect(result.current.workflows[0].workflowId).toBe("wf-id");
  });
});
