/**
 * Vote-tally semantics for forum votes (45002): per-voter latest-wins with
 * (created_at, id) tie-breaks, author-matched retractions, order-independent
 * replay.
 */

import { describe, it, expect } from "vitest";
import { VoteTally } from "../vote-tally";

const ME = "m".repeat(64);
const OTHER = "o".repeat(64);

function vote(id: string, voter: string, target: string, at: number, content = "+") {
  return { id, pubkey: voter, created_at: at, content, tags: [["h", "g"], ["e", target]] };
}

function retract(author: string, voteEventId: string, at = 999) {
  return { pubkey: author, created_at: at, content: "", tags: [["e", voteEventId]] };
}

describe("VoteTally.applyVote", () => {
  it("counts up and down votes per target", () => {
    const t = new VoteTally();
    t.applyVote(vote("v1", ME, "post1", 100));
    t.applyVote(vote("v2", OTHER, "post1", 100, "-"));
    const s = t.summaryFor("post1");
    expect(s.up).toBe(1);
    expect(s.down).toBe(1);
    expect(s.score).toBe(0);
  });

  it("one vote per voter: latest created_at replaces", () => {
    const t = new VoteTally();
    t.applyVote(vote("v1", ME, "post1", 100));
    expect(t.applyVote(vote("v2", ME, "post1", 200, "-"))).toBe(true);
    const s = t.summaryFor("post1", ME);
    expect(s.up).toBe(0);
    expect(s.down).toBe(1);
    expect(s.myVote).toBe("down");
    expect(s.myVoteEventId).toBe("v2");
  });

  it("stale re-vote does not displace a newer one", () => {
    const t = new VoteTally();
    t.applyVote(vote("v2", ME, "post1", 200, "-"));
    expect(t.applyVote(vote("v1", ME, "post1", 100))).toBe(false);
    expect(t.summaryFor("post1", ME).myVote).toBe("down");
  });

  it("breaks same-second ties by larger event id", () => {
    const t = new VoteTally();
    t.applyVote(vote("aaa", ME, "post1", 100));
    expect(t.applyVote(vote("zzz", ME, "post1", 100, "-"))).toBe(true);
    expect(t.applyVote(vote("mmm", ME, "post1", 100))).toBe(false);
    expect(t.summaryFor("post1", ME).myVote).toBe("down");
  });

  it("ignores invalid content and missing e-tag", () => {
    const t = new VoteTally();
    expect(t.applyVote(vote("v1", ME, "post1", 100, "nice"))).toBe(false);
    expect(t.applyVote({ ...vote("v2", ME, "post1", 100), tags: [["h", "g"]] })).toBe(false);
    expect(t.summaryFor("post1").up).toBe(0);
  });
});

describe("VoteTally.applyDeletion", () => {
  it("retracts the voter's own vote", () => {
    const t = new VoteTally();
    t.applyVote(vote("v1", ME, "post1", 100));
    expect(t.applyDeletion(retract(ME, "v1"))).toBe(true);
    expect(t.summaryFor("post1", ME).myVote).toBeNull();
    expect(t.summaryFor("post1").up).toBe(0);
  });

  it("suppresses a vote that arrives AFTER its retraction (replay order)", () => {
    const t = new VoteTally();
    t.applyDeletion(retract(ME, "v1"));
    expect(t.applyVote(vote("v1", ME, "post1", 100))).toBe(false);
    expect(t.summaryFor("post1").up).toBe(0);
  });

  it("ignores retractions from a different author", () => {
    const t = new VoteTally();
    t.applyVote(vote("v1", ME, "post1", 100));
    expect(t.applyDeletion(retract(OTHER, "v1"))).toBe(false);
    expect(t.summaryFor("post1").up).toBe(1);
  });

  it("a non-author retraction does not suppress the vote on later replay either", () => {
    const t = new VoteTally();
    t.applyDeletion(retract(OTHER, "v1"));
    expect(t.applyVote(vote("v1", ME, "post1", 100))).toBe(true);
    expect(t.summaryFor("post1").up).toBe(1);
  });
});

describe("VoteTally.summaries", () => {
  it("covers all targets with myVote resolved against the given pubkey", () => {
    const t = new VoteTally();
    t.applyVote(vote("v1", ME, "post1", 100));
    t.applyVote(vote("v2", OTHER, "post2", 100, "-"));
    const all = t.summaries(ME);
    expect(all.get("post1")?.myVote).toBe("up");
    expect(all.get("post2")?.myVote).toBeNull();
    expect(all.get("post2")?.score).toBe(-1);
  });
});
