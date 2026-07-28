/**
 * Tests for approval correlation and DM classification in the home inbox
 * (review findings): workflow approvals key on the `run` tag — not NIP-10
 * e-roots — and untagged DM-feed events are activity, never mentions.
 */

import { describe, expect, it } from "vitest";
import { approvalRunKeyOf } from "../use-home-inbox";
import type { NostrEvent } from "@/shared/lib/relay-connection";

const PUBKEY = "b".repeat(64);

function ev(kind: number, tags: string[][], id = "evt-1"): NostrEvent {
  return { id, pubkey: PUBKEY, kind, created_at: 100, tags, content: "", sig: "" } as NostrEvent;
}

describe("approvalRunKeyOf", () => {
  it("keys approvals on the run tag, not e-roots", () => {
    const request = ev(46010, [["h", "chan"], ["run", "run-42"], ["workflow", "wf-1"], ["p", PUBKEY]]);
    const granted = ev(46011, [["h", "chan"], ["run", "run-42"], ["workflow", "wf-1"], ["p", PUBKEY]], "evt-2");
    expect(approvalRunKeyOf(request)).toBe("run-42");
    expect(approvalRunKeyOf(granted)).toBe("run-42");
  });

  it("resolves out-of-order: denial key matches request key regardless of arrival order", () => {
    const denied = ev(46012, [["run", "run-7"], ["p", PUBKEY]], "evt-early");
    const request = ev(46010, [["run", "run-7"], ["p", PUBKEY]], "evt-late");
    expect(approvalRunKeyOf(denied)).toBe(approvalRunKeyOf(request));
  });

  it("distinguishes different runs", () => {
    expect(approvalRunKeyOf(ev(46011, [["run", "run-1"]]))).not.toBe(
      approvalRunKeyOf(ev(46012, [["run", "run-2"]])),
    );
  });

  it("falls back to e-root then event id when no run tag exists", () => {
    expect(approvalRunKeyOf(ev(46011, [["e", "legacy-root", "", "root"]]))).toBe("legacy-root");
    expect(approvalRunKeyOf(ev(46011, [], "evt-self"))).toBe("evt-self");
  });
});
