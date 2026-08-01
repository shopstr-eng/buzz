/**
 * Cross-device mark-unread propagation: inbound NIP-RS override registers
 * (merged by use-sync-30078) must move the local badge store — an active
 * remote override reverts the marker and pins a dot-only badge; a remote
 * clear or a frontier advance past the baseline releases it.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

async function freshModule() {
  vi.resetModules();
  return await import("../use-read-state");
}

describe("syncForcedFromOverrides (wire → badge propagation)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("an active remote override reverts the local marker and pins a dot-only badge", async () => {
    const m = await freshModule();
    const chan = "chan-remote-force";
    m.markChannelRead(chan, 500); // this client had read up to t=500
    // Remote blob merges to override {s:1,c:0,b:300} with frontier 300.
    m.syncForcedFromOverrides({ [chan]: { s: 1, c: 0, b: 300 } }, { [chan]: 300 });
    expect(m.getChannelMarker(chan)).toBe(300); // reverted to the baseline
    expect(m.getForcedSnapshot()[chan]).toBe(300);
    // Badge verdict: messages past the baseline stay dot-only, no count.
    const unread = m.computeUnreadMap(
      [
        { h: chan, ts: 400, mine: false, mention: false },
        { h: chan, ts: 450, mine: false, mention: true },
      ],
      m.getForcedSnapshot(),
      { [chan]: m.getChannelMarker(chan) },
    );
    expect(unread.get(chan)).toEqual({ count: 1, mention: false });
  });

  it("a remote clear (clear counter wins) releases the forced dot", async () => {
    const m = await freshModule();
    const chan = "chan-remote-clear";
    m.markChannelForcedUnread(chan, 300);
    expect(m.getForcedSnapshot()[chan]).toBe(300);
    // Remote clear: c catches up to s → register inactive at frontier 300.
    m.syncForcedFromOverrides({ [chan]: { s: 1, c: 1, b: 300 } }, { [chan]: 300 });
    expect(m.getForcedSnapshot()[chan]).toBeUndefined();
    // Badge falls back to normal counting against the marker.
    const unread = m.computeUnreadMap(
      [{ h: chan, ts: 400, mine: false, mention: false }],
      m.getForcedSnapshot(),
      { [chan]: m.getChannelMarker(chan) },
    );
    expect(unread.get(chan)).toEqual({ count: 1, mention: false });
  });

  it("a frontier advance past the baseline releases the forced dot", async () => {
    const m = await freshModule();
    const chan = "chan-frontier-advance";
    m.markChannelForcedUnread(chan, 300);
    // A read on another device pushed the frontier past the baseline; the
    // register (still s>c) is now inactive.
    m.syncForcedFromOverrides({ [chan]: { s: 1, c: 0, b: 300 } }, { [chan]: 301 });
    expect(m.getForcedSnapshot()[chan]).toBeUndefined();
  });

  it("an inactive register does not clobber a force pinning a different baseline", async () => {
    const m = await freshModule();
    const chan = "chan-newer-force";
    // Newer local force at baseline 700.
    m.markChannelForcedUnread(chan, 700);
    // Stale merged register (b:300) is inactive — it must not clear the 700 pin.
    m.syncForcedFromOverrides({ [chan]: { s: 1, c: 1, b: 300 } }, { [chan]: 300 });
    expect(m.getForcedSnapshot()[chan]).toBe(700);
  });

  it("an active remote override never RAISES the local marker", async () => {
    const m = await freshModule();
    const chan = "chan-no-raise";
    m.markChannelRead(chan, 100);
    m.syncForcedFromOverrides({ [chan]: { s: 1, c: 0, b: 300 } }, { [chan]: 300 });
    expect(m.getChannelMarker(chan)).toBe(100); // marker untouched below baseline
    expect(m.getForcedSnapshot()[chan]).toBe(300); // but the pin is set
  });

  it("ignores msg:/thread: override contexts (no badge representation)", async () => {
    const m = await freshModule();
    m.syncForcedFromOverrides(
      {
        "msg:chan-1:evt-9": { s: 1, c: 0, b: 50 },
        "thread:chan-1:root-1": { s: 2, c: 0, b: 60 },
      },
      { "msg:chan-1:evt-9": 50, "thread:chan-1:root-1": 60 },
    );
    expect(m.getForcedSnapshot()).toEqual({});
  });
});
