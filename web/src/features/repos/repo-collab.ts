/**
 * NIP-34 collaboration primitives shared by the repo issues and pull
 * requests hooks: kinds, tag builders, status resolution, and comment
 * folding. Tag shapes mirror the desktop client
 * (desktop/src/features/projects: issues 1621, PRs 1618, updates 1619,
 * patches 1617, status 1630–1633, comments kind 1).
 */

import type { NostrEvent } from "@/shared/lib/relay-connection";

export const KIND_PATCH = 1617;
export const KIND_PULL_REQUEST = 1618;
export const KIND_PR_UPDATE = 1619;
export const KIND_ISSUE = 1621;
export const KIND_STATUS_OPEN = 1630;
export const KIND_STATUS_RESOLVED = 1631; // Done (issue) / Merged (PR)
export const KIND_STATUS_CLOSED = 1632;
export const KIND_STATUS_DRAFT = 1633; // Draft (PR) / Triage (issue)
export const KIND_COMMENT = 1;

export const STATUS_KINDS = [
  KIND_STATUS_OPEN,
  KIND_STATUS_RESOLVED,
  KIND_STATUS_CLOSED,
  KIND_STATUS_DRAFT,
];

/** NIP-34 address coordinate for a repo announcement. */
export function repoCoordinate(owner: string, repoName: string): string {
  return `30617:${owner}:${repoName}`;
}

export type IssueStatus = "open" | "done" | "closed" | "triage";
export type PrStatus = "open" | "merged" | "closed" | "draft";

export interface RootStatusEvent {
  id: string;
  rootId: string;
  kind: number;
  pubkey: string;
  createdAt: number;
}

/** Root id of a status/comment/update event: e/E tag marked "root", else first. */
export function rootIdOf(ev: NostrEvent): string | null {
  const eTags = ev.tags.filter((t) => t[0] === "e" || t[0] === "E");
  const root = eTags.find((t) => t[3] === "root") ?? eTags[0];
  return root?.[1] ?? null;
}

/**
 * Latest status kind for a root, counting only events signed by the root
 * author or the repo owner (the desktop's maintainer rule, simplified).
 * Ties on created_at break deterministically by event id so every client
 * resolves the same winner regardless of delivery order.
 */
export function resolveStatusKind(
  events: RootStatusEvent[],
  allowedAuthors: Set<string>,
): number | null {
  let latest: RootStatusEvent | null = null;
  for (const ev of events) {
    if (!allowedAuthors.has(ev.pubkey)) continue;
    if (
      !latest ||
      ev.createdAt > latest.createdAt ||
      (ev.createdAt === latest.createdAt && ev.id > latest.id)
    ) {
      latest = ev;
    }
  }
  return latest?.kind ?? null;
}

/**
 * Filter root-scoped events (e.g. kind-1619 PR updates) to signers the
 * desktop trusts: the root author or the repo owner. Untrusted events are
 * rendered by neither client.
 */
export function filterTrustedAuthors<T extends { pubkey: string }>(
  events: T[],
  allowedAuthors: Set<string>,
): T[] {
  return events.filter((ev) => allowedAuthors.has(ev.pubkey));
}

/**
 * Monotonic created_at for lifecycle writes: two status events published in
 * the same second would otherwise race on relay delivery order. Bumps one
 * second past the latest status event seen for the root when needed.
 */
export function monotonicCreatedAt(lastKnown: number | null): number {
  const now = Math.floor(Date.now() / 1000);
  return lastKnown !== null && now <= lastKnown ? lastKnown + 1 : now;
}

export function issueStatusFromKind(
  kind: number | null,
  labels: string[],
): IssueStatus {
  switch (kind) {
    case KIND_STATUS_RESOLVED:
      return "done";
    case KIND_STATUS_CLOSED:
      return "closed";
    case KIND_STATUS_DRAFT:
      return "triage";
    case KIND_STATUS_OPEN:
      return "open";
    default:
      // Label heuristic fallback, mirroring the desktop.
      return labels.includes("triage") ? "triage" : "open";
  }
}

export function prStatusFromKind(kind: number | null, labels: string[]): PrStatus {
  switch (kind) {
    case KIND_STATUS_RESOLVED:
      return "merged";
    case KIND_STATUS_CLOSED:
      return "closed";
    case KIND_STATUS_DRAFT:
      return "draft";
    case KIND_STATUS_OPEN:
      return "open";
    default:
      return labels.includes("draft") ? "draft" : "open";
  }
}

/** Status kind to publish for a requested transition (shared by issues/PRs). */
export function statusKindFor(target: "open" | "resolved" | "closed" | "draft"): number {
  switch (target) {
    case "open":
      return KIND_STATUS_OPEN;
    case "resolved":
      return KIND_STATUS_RESOLVED;
    case "closed":
      return KIND_STATUS_CLOSED;
    case "draft":
      return KIND_STATUS_DRAFT;
  }
}

/** Tags for a status event: e(root) + a(repo) + p(owner) + p(root author). */
export function statusTags(
  rootId: string,
  rootAuthor: string,
  owner: string,
  coordinate: string,
): string[][] {
  const tags = [["e", rootId, "", "root"], ["a", coordinate], ["p", owner]];
  if (rootAuthor !== owner) tags.push(["p", rootAuthor]);
  return tags;
}

/** Tags for a kind-1 comment on an issue/PR. */
export function commentTags(
  rootId: string,
  rootAuthor: string,
  owner: string,
  coordinate: string,
): string[][] {
  const tags = [["e", rootId, "", "root"], ["a", coordinate], ["p", owner]];
  if (rootAuthor !== owner) tags.push(["p", rootAuthor]);
  return tags;
}

export type ReviewMark = "approval" | "changes-requested" | "review-request";

export interface RepoComment {
  id: string;
  pubkey: string;
  content: string;
  createdAt: number;
  review?: ReviewMark;
  inline?: { file: string; line: string | null; side: string | null };
}

/** Parse a kind-1 event into a comment; null when it doesn't belong to a root. */
export function parseComment(ev: NostrEvent): { rootId: string; comment: RepoComment } | null {
  const rootId = rootIdOf(ev);
  if (!rootId) return null;
  const tTags = ev.tags.filter((t) => t[0] === "t").map((t) => t[1]);
  let review: ReviewMark | undefined;
  if (tTags.includes("approval")) review = "approval";
  else if (tTags.includes("changes-requested")) review = "changes-requested";
  else if (tTags.includes("review-request")) review = "review-request";
  let inline: RepoComment["inline"];
  if (tTags.includes("inline-comment")) {
    const file = ev.tags.find((t) => t[0] === "file")?.[1];
    if (file) {
      inline = {
        file,
        line: ev.tags.find((t) => t[0] === "line")?.[1] ?? null,
        side: ev.tags.find((t) => t[0] === "side")?.[1] ?? null,
      };
    }
  }
  return {
    rootId,
    comment: {
      id: ev.id,
      pubkey: ev.pubkey,
      content: ev.content,
      createdAt: ev.created_at,
      ...(review ? { review } : {}),
      ...(inline ? { inline } : {}),
    },
  };
}
