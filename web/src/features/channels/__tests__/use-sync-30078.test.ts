/**
 * Hook-level tests for use-sync-30078 — the stateful NIP-RS flow the pure
 * helper tests cannot see. Drives the hook with a fake RelayConnection and a
 * fake nip44 (enc:<plaintext>) and pins:
 *  1. markChannelUnread fails "not-ready" before the full-state load
 *     completes and succeeds after;
 *  2. a stale replayed blob (older created_at for a client_id already seen)
 *     never lowers merged override counters;
 *  3. a foreign client_id on our d-tag rotates the slot and republishes the
 *     FULL override set under the fresh slot id (NIP-RS carry-forward);
 *  4. over-budget publishes are refused outright — never truncated — and the
 *     debounced-publish path downgrades loadComplete so later override
 *     actions fail "not-ready".
 */

import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";

vi.mock("@/shared/context/relay-context", () => ({
  useRelay: vi.fn(),
}));
vi.mock("@/shared/lib/identity", () => ({
  getSignFn: vi.fn(),
}));
vi.mock("@/shared/lib/nip44-self", () => ({
  getNip44SelfAsync: vi.fn(),
}));

import { useRelay } from "@/shared/context/relay-context";
import { getSignFn } from "@/shared/lib/identity";
import { getNip44SelfAsync } from "@/shared/lib/nip44-self";
import { markChannelUnread, useSync30078 } from "../use-sync-30078";
import { markChannelRead } from "../use-read-state";
import type { NostrEvent, NostrFilter } from "@/shared/lib/relay-connection";

const ME = "ab".repeat(32);
const MY_CLIENT = "my-client-id";
const SLOT = "0123456789abcdef0123456789abcdef"; // 32 hex chars (randomHex(32) shape)
const PEER_SLOT = `read-state:${"f".repeat(32)}`;

interface Sub {
  filter: NostrFilter;
  onEvent: (ev: NostrEvent) => void;
  onEose?: () => void;
}

interface Slot {
  v: number;
  client_id: string;
  contexts: Record<string, number>;
}

let blobSeq = 0;
function blob(
  clientId: string,
  contexts: Record<string, number>,
  created_at: number,
  dTag: string,
): NostrEvent {
  return {
    id: `blob-${clientId}-${created_at}-${blobSeq++}`,
    pubkey: ME,
    kind: 30078,
    created_at,
    tags: [
      ["d", dTag],
      ["t", "read-state"],
    ],
    content: `enc:${JSON.stringify({ v: 1, client_id: clientId, contexts })}`,
    sig: "s",
  } as NostrEvent;
}

function setup() {
  localStorage.setItem(`buzz.nip-rs.client-id:${ME}`, MY_CLIENT);
  localStorage.setItem(`buzz.nip-rs.slot-id:${ME}`, SLOT);

  const subs: Sub[] = [];
  const published: NostrEvent[] = [];
  const connection = {
    subscribe: vi.fn(
      (filter: NostrFilter, onEvent: (ev: NostrEvent) => void, onEose?: () => void) => {
        subs.push({ filter, onEvent, onEose });
        return () => {};
      },
    ),
    publish: vi.fn((ev: NostrEvent) => {
      published.push(ev);
    }),
  };

  (useRelay as Mock).mockReturnValue({
    connection,
    connectionState: "ready",
    identity: { pubkey: ME, type: "nsec" },
  });
  (getNip44SelfAsync as Mock).mockResolvedValue({
    encrypt: async (pt: string) => `enc:${pt}`,
    decrypt: async (ct: string) => {
      if (!ct.startsWith("enc:")) throw new Error("undecryptable");
      return ct.slice(4);
    },
  });
  let n = 0;
  (getSignFn as Mock).mockReturnValue(
    async (t: Omit<NostrEvent, "id" | "pubkey" | "sig">) =>
      ({ ...t, id: `signed-${n++}`, pubkey: ME, sig: "s" }) as NostrEvent,
  );

  const view = renderHook(() => useSync30078());
  return { subs, published, unmount: view.unmount };
}

/** Fence EOSE → enumeration pages (last page short of the floor completes). */
async function completeLoad(subs: Sub[], pages: NostrEvent[][] = [[]]) {
  await act(async () => {
    subs[0].onEose?.();
  });
  for (const events of pages) {
    const page = subs[subs.length - 1];
    expect(page).not.toBe(subs[0]); // enumeration query actually issued
    await act(async () => {
      for (const ev of events) page.onEvent(ev);
      page.onEose?.();
    });
  }
}

function readStatePublishes(published: NostrEvent[]): Array<{ dTag: string; slot: Slot }> {
  return published
    .filter((ev) => ev.tags.find((t) => t[0] === "d")?.[1]?.startsWith("read-state:"))
    .map((ev) => ({
      dTag: ev.tags.find((t) => t[0] === "d")![1],
      slot: JSON.parse(ev.content.slice(4)) as Slot,
    }));
}

describe("useSync30078 (stateful NIP-RS flow)", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("markChannelUnread fails not-ready before load completion and succeeds after", async () => {
    const { subs, unmount } = setup();
    // Fence up, enumeration not yet complete.
    expect(markChannelUnread("t1-chan", 100)).toEqual({ ok: false, reason: "not-ready" });
    await act(async () => {
      subs[0].onEose?.();
    });
    // Enumeration in flight (page issued, no EOSE yet) — still not ready.
    expect(markChannelUnread("t1-chan", 100)).toEqual({ ok: false, reason: "not-ready" });
    const page = subs[subs.length - 1];
    await act(async () => {
      page.onEose?.(); // empty page — load proven complete
    });
    expect(markChannelUnread("t1-chan", 100)).toEqual({ ok: true });
    unmount();
    // Session torn down — actions refuse again.
    expect(markChannelUnread("t1-chan", 100)).toEqual({ ok: false, reason: "not-ready" });
  });

  it("a stale replayed blob does not lower merged override counters", async () => {
    const { subs, published, unmount } = setup();
    await completeLoad(subs, [
      [
        blob(
          "peer1",
          { "t2-chan": 100, "ov_s:t2-chan": 3, "ov_c:t2-chan": 2, "ov_b:t2-chan": 100 },
          2000,
          PEER_SLOT,
        ),
      ],
    ]);
    // Stale replay: same client_id, OLDER created_at, lower counters.
    await act(async () => {
      subs[0].onEvent(
        blob(
          "peer1",
          { "t2-chan": 50, "ov_s:t2-chan": 1, "ov_c:t2-chan": 0, "ov_b:t2-chan": 100 },
          1000,
          PEER_SLOT,
        ),
      );
    });
    // Force a publish and inspect the merged wire state.
    expect(markChannelUnread("t2-other", 5)).toEqual({ ok: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });
    const pubs = readStatePublishes(published);
    const last = pubs[pubs.length - 1].slot.contexts;
    expect(last["ov_s:t2-chan"]).toBe(3); // not lowered to 1
    expect(last["ov_c:t2-chan"]).toBe(2); // not lowered to 0
    expect(last["t2-chan"]).toBe(100); // frontier not lowered to 50
    unmount();
  });

  it("slot rotation republishes the full override set under the fresh slot id", async () => {
    const { subs, published, unmount } = setup();
    await completeLoad(subs, [
      [
        blob(
          "peer1",
          { "t3-chan": 100, "ov_s:t3-chan": 1, "ov_c:t3-chan": 0, "ov_b:t3-chan": 100 },
          2000,
          PEER_SLOT,
        ),
      ],
    ]);
    const before = readStatePublishes(published);
    // Foreign client_id lands on OUR d-tag → desktop collision rule.
    await act(async () => {
      subs[0].onEvent(blob("intruder", {}, 3000, `read-state:${SLOT}`));
    });
    const after = readStatePublishes(published);
    expect(after.length).toBeGreaterThan(before.length);
    const rotated = after[after.length - 1];
    expect(rotated.dTag).not.toBe(`read-state:${SLOT}`);
    expect(rotated.dTag).toMatch(/^read-state:[0-9a-f]{32}$/);
    // Carry-forward: the fresh coordinate carries every ov_* register + frontier.
    expect(rotated.slot.client_id).toBe(MY_CLIENT);
    expect(rotated.slot.contexts["ov_s:t3-chan"]).toBe(1);
    expect(rotated.slot.contexts["ov_c:t3-chan"]).toBe(0);
    expect(rotated.slot.contexts["ov_b:t3-chan"]).toBe(100);
    expect(rotated.slot.contexts["t3-chan"]).toBe(100);
    // The rotated slot id also persisted for the next session.
    expect(localStorage.getItem(`buzz.nip-rs.slot-id:${ME}`)).toBe(
      rotated.dTag.slice("read-state:".length),
    );
    unmount();
  });

  it("over-budget publishes are refused — never truncated", async () => {
    const { subs, published, unmount } = setup();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // >32KB of tombstone floors (ov_* entries are exempt from eviction).
    const huge: Record<string, number> = {};
    for (let i = 0; i < 3000; i++) huge[`ov_c:t4-big-ctx-${String(i).padStart(4, "0")}`] = 1;
    await completeLoad(subs, [[blob("peer1", huge, 2000, PEER_SLOT)]]);
    // Completion republish must have been refused, not truncated.
    expect(readStatePublishes(published)).toHaveLength(0);
    // Override action refuses visibly at the ceiling.
    expect(markChannelUnread("t4-chan", 1)).toEqual({ ok: false, reason: "budget-exceeded" });
    // Debounced local-mark publish path: refusal downgrades loadComplete...
    act(() => {
      markChannelRead("t4-local", 123);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });
    expect(readStatePublishes(published)).toHaveLength(0); // still nothing on the wire
    // ...so subsequent override actions fail not-ready, never silently.
    expect(markChannelUnread("t4-chan", 1)).toEqual({ ok: false, reason: "not-ready" });
    warn.mockRestore();
    unmount();
  });
});
