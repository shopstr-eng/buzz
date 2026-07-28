/**
 * Repository issues (NIP-34 kind 1621) plus their status events (1630–1633)
 * and kind-1 comments — one `#a` subscription per repo.
 *
 * Tag shapes mirror the desktop: issues carry `a` (repo coordinate), `p`
 * (owner), `subject`, `t` (labels); status events carry `e`(root)/`a`/`p` and
 * only count when signed by the issue author or repo owner.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRelay } from "@/shared/context/relay-context";
import { getSignFn } from "@/shared/lib/identity";
import type { NostrEvent } from "@/shared/lib/relay-connection";
import {
  KIND_COMMENT,
  KIND_ISSUE,
  STATUS_KINDS,
  issueStatusFromKind,
  monotonicCreatedAt,
  parseComment,
  repoCoordinate,
  resolveStatusKind,
  rootIdOf,
  statusKindFor,
  statusTags,
  commentTags,
  type IssueStatus,
  type RepoComment,
  type RootStatusEvent,
} from "./repo-collab";

export interface RepoIssue {
  id: string;
  pubkey: string;
  subject: string;
  content: string;
  labels: string[];
  createdAt: number;
  status: IssueStatus;
  commentCount: number;
}

interface IssueBase {
  id: string;
  pubkey: string;
  subject: string;
  content: string;
  labels: string[];
  createdAt: number;
}

export function useRepoIssues(
  owner: string,
  repoName: string,
  enabled: boolean,
): {
  issues: RepoIssue[];
  commentsByRoot: Record<string, RepoComment[]>;
  isLoading: boolean;
  createIssue: (subject: string, content: string, labels: string[]) => Promise<void>;
  setIssueStatus: (issue: RepoIssue, target: "open" | "resolved" | "closed" | "draft") => Promise<void>;
  addComment: (issue: RepoIssue, content: string) => Promise<void>;
  error: string | null;
} {
  const { connection, connectionState, identity } = useRelay();
  const [issues, setIssues] = useState<RepoIssue[]>([]);
  const [commentsByRoot, setCommentsByRoot] = useState<Record<string, RepoComment[]>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Latest status-event timestamp per root — for monotonic status writes. */
  const latestStatusAt = useRef(new Map<string, number>());

  useEffect(() => {
    if (!connection || connectionState !== "ready" || !owner || !repoName || !enabled) return;

    const coordinate = repoCoordinate(owner, repoName);
    const issueMap = new Map<string, IssueBase>();
    const statusEvents: RootStatusEvent[] = [];
    const commentMap = new Map<string, RepoComment[]>();
    const seen = new Set<string>();

    function rebuild() {
      const list: RepoIssue[] = [...issueMap.values()].map((issue) => {
        const kind = resolveStatusKind(
          statusEvents.filter((s) => s.rootId === issue.id),
          new Set([issue.pubkey, owner]),
        );
        return {
          ...issue,
          status: issueStatusFromKind(kind, issue.labels),
          commentCount: commentMap.get(issue.id)?.length ?? 0,
        };
      });
      list.sort((a, b) => b.createdAt - a.createdAt);
      setIssues(list);
      setCommentsByRoot(
        Object.fromEntries(
          [...commentMap.entries()].map(([k, v]) => [
            k,
            [...v].sort((a, b) => a.createdAt - b.createdAt),
          ]),
        ),
      );
    }

    const unsub = connection.subscribe(
      {
        kinds: [KIND_ISSUE, KIND_COMMENT, ...STATUS_KINDS],
        "#a": [coordinate],
        limit: 500,
      },
      (ev: NostrEvent) => {
        if (seen.has(ev.id)) return;
        seen.add(ev.id);
        if (ev.kind === KIND_ISSUE) {
          issueMap.set(ev.id, {
            id: ev.id,
            pubkey: ev.pubkey,
            subject: ev.tags.find((t) => t[0] === "subject")?.[1] ?? "(no title)",
            content: ev.content,
            labels: ev.tags.filter((t) => t[0] === "t").map((t) => t[1]),
            createdAt: ev.created_at,
          });
        } else if (STATUS_KINDS.includes(ev.kind)) {
          const rootId = rootIdOf(ev);
          if (rootId) {
            statusEvents.push({ id: ev.id, rootId, kind: ev.kind, pubkey: ev.pubkey, createdAt: ev.created_at });
            const prev = latestStatusAt.current.get(rootId) ?? 0;
            if (ev.created_at > prev) latestStatusAt.current.set(rootId, ev.created_at);
          }
        } else if (ev.kind === KIND_COMMENT) {
          const parsed = parseComment(ev);
          if (parsed) {
            const list = commentMap.get(parsed.rootId) ?? [];
            list.push(parsed.comment);
            commentMap.set(parsed.rootId, list);
          }
        }
        rebuild();
      },
      () => setIsLoading(false),
    );

    return () => unsub();
  }, [connection, connectionState, owner, repoName, enabled]);

  const publish = useCallback(
    async (kind: number, tags: string[][], content: string, errMsg: string, createdAt?: number) => {
      if (!connection) { setError("Not connected to relay."); return; }
      const signFn = getSignFn();
      if (!signFn) { setError("No signing key available."); return; }
      try {
        const signed = await signFn({
          kind,
          created_at: createdAt ?? Math.floor(Date.now() / 1000),
          tags,
          content,
        });
        connection.publish(signed);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : errMsg);
      }
    },
    [connection],
  );

  const coordinate = owner && repoName ? repoCoordinate(owner, repoName) : "";

  const createIssue = useCallback(
    async (subject: string, content: string, labels: string[]) => {
      if (!identity) { setError("Sign in to create issues."); return; }
      const tags = [["a", coordinate], ["p", owner], ["subject", subject]];
      for (const label of labels) tags.push(["t", label]);
      await publish(KIND_ISSUE, tags, content, "Failed to create issue.");
    },
    [publish, coordinate, owner, identity],
  );

  const setIssueStatus = useCallback(
    async (issue: RepoIssue, target: "open" | "resolved" | "closed" | "draft") => {
      await publish(
        statusKindFor(target),
        statusTags(issue.id, issue.pubkey, owner, coordinate),
        "",
        "Failed to update issue status.",
        monotonicCreatedAt(latestStatusAt.current.get(issue.id) ?? null),
      );
    },
    [publish, owner, coordinate],
  );

  const addComment = useCallback(
    async (issue: RepoIssue, content: string) => {
      await publish(
        KIND_COMMENT,
        commentTags(issue.id, issue.pubkey, owner, coordinate),
        content,
        "Failed to post comment.",
      );
    },
    [publish, owner, coordinate],
  );

  return { issues, commentsByRoot, isLoading, createIssue, setIssueStatus, addComment, error };
}
