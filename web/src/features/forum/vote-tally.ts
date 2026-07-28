/**
 * Vote aggregation for forum posts (45001) and comments (45003) from kind
 * 45002 events. Pure — extracted from use-forum.ts for testability.
 *
 * Client convention (desktop never implemented 45002; the relay validates
 * only the e-tag target + channel match):
 * - Content "+" = upvote, "-" = downvote (NIP-25 style). Anything else ignored.
 * - One vote per (voter, target): latest created_at wins, same-second ties go
 *   to the larger event id (NIP-33-style resolution).
 * - Retraction is kind 5 with a single e-tag naming the vote event. Only
 *   honored when the deletion author matches the vote author, and applied
 *   order-independently (deletion can arrive before the vote it retracts).
 */

export type VoteDirection = "up" | "down";

export interface VoteSummary {
  up: number;
  down: number;
  score: number;
  myVote: VoteDirection | null;
  myVoteEventId: string | null;
}

export interface VoteEventLike {
  id: string;
  pubkey: string;
  created_at: number;
  content: string;
  tags: string[][];
}

interface VoteRecord {
  at: number;
  id: string;
  dir: VoteDirection;
}

function parseDirection(content: string): VoteDirection | null {
  const c = content.trim();
  if (c === "+") return "up";
  if (c === "-") return "down";
  return null;
}

export class VoteTally {
  private byTarget = new Map<string, Map<string, VoteRecord>>();
  /** vote event id → deletion author pubkey. */
  private retracted = new Map<string, string>();

  /** Returns true when any target's tally changed. */
  applyVote(ev: VoteEventLike): boolean {
    const dir = parseDirection(ev.content);
    const target = ev.tags.find((t) => t[0] === "e" && t[1])?.[1];
    if (!dir || !target) return false;
    if (this.retracted.get(ev.id) === ev.pubkey) return false;

    let voters = this.byTarget.get(target);
    if (!voters) {
      voters = new Map();
      this.byTarget.set(target, voters);
    }
    const existing = voters.get(ev.pubkey);
    if (
      existing &&
      (existing.at > ev.created_at || (existing.at === ev.created_at && existing.id >= ev.id))
    ) {
      return false;
    }
    voters.set(ev.pubkey, { at: ev.created_at, id: ev.id, dir });
    return true;
  }

  /** Kind-5 retraction; only honored when authored by the vote's author. */
  applyDeletion(ev: { pubkey: string; tags: string[][] }): boolean {
    let changed = false;
    for (const tag of ev.tags) {
      if (tag[0] !== "e" || !tag[1]) continue;
      this.retracted.set(tag[1], ev.pubkey);
      for (const voters of this.byTarget.values()) {
        const rec = voters.get(ev.pubkey);
        if (rec && rec.id === tag[1]) {
          voters.delete(ev.pubkey);
          changed = true;
        }
      }
    }
    return changed;
  }

  summaryFor(target: string, me?: string): VoteSummary {
    const voters = this.byTarget.get(target);
    const summary: VoteSummary = { up: 0, down: 0, score: 0, myVote: null, myVoteEventId: null };
    if (!voters) return summary;
    for (const [voter, rec] of voters) {
      if (rec.dir === "up") summary.up += 1;
      else summary.down += 1;
      if (voter === me) {
        summary.myVote = rec.dir;
        summary.myVoteEventId = rec.id;
      }
    }
    summary.score = summary.up - summary.down;
    return summary;
  }

  summaries(me?: string): Map<string, VoteSummary> {
    const out = new Map<string, VoteSummary>();
    for (const target of this.byTarget.keys()) {
      out.set(target, this.summaryFor(target, me));
    }
    return out;
  }
}
