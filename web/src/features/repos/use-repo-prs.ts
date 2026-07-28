/**
 * Repository pull requests (NIP-34 kind 1618), PR updates (1619), standalone
 * patches (1617), status events (1630–1633) and kind-1 comments/reviews —
 * one `#a` subscription per repo.
 *
 * Tag shapes mirror the desktop: PRs carry `a`, `p` (owner+reviewers),
 * `subject`, `c` (tip commit), `clone`, `branch-name`, `target-branch`;
 * updates carry `E`(root PR)/`c`/`clone`. Merging is NOT possible from the
 * web (the desktop merges via a Tauri git command) — web exposes
 * close/reopen/draft status only.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRelay } from "@/shared/context/relay-context";
import { getSignFn } from "@/shared/lib/identity";
import type { NostrEvent } from "@/shared/lib/relay-connection";
import {
  KIND_COMMENT,
  KIND_PATCH,
  KIND_PULL_REQUEST,
  KIND_PR_UPDATE,
  STATUS_KINDS,
  commentTags,
  filterTrustedAuthors,
  monotonicCreatedAt,
  parseComment,
  prStatusFromKind,
  repoCoordinate,
  resolveStatusKind,
  rootIdOf,
  statusKindFor,
  statusTags,
  type PrStatus,
  type RepoComment,
  type RootStatusEvent,
} from "./repo-collab";

export interface PrUpdate {
  id: string;
  pubkey: string;
  commit: string | null;
  createdAt: number;
}

export interface RepoPr {
  id: string;
  pubkey: string;
  subject: string;
  content: string;
  tipCommit: string | null;
  branchName: string | null;
  targetBranch: string | null;
  cloneUrls: string[];
  labels: string[];
  createdAt: number;
  status: PrStatus;
  updates: PrUpdate[];
  commentCount: number;
}

export interface RepoPatch {
  id: string;
  pubkey: string;
  /** The raw patch/diff text. */
  content: string;
  createdAt: number;
}

interface PrBase {
  id: string;
  pubkey: string;
  subject: string;
  content: string;
  tipCommit: string | null;
  branchName: string | null;
  targetBranch: string | null;
  cloneUrls: string[];
  labels: string[];
  createdAt: number;
}

export interface CreatePrInput {
  subject: string;
  content: string;
  branchName: string;
  targetBranch: string;
  tipCommit: string;
  cloneUrl: string;
}

export function useRepoPrs(
  owner: string,
  repoName: string,
  enabled: boolean,
): {
  prs: RepoPr[];
  patches: RepoPatch[];
  commentsByRoot: Record<string, RepoComment[]>;
  isLoading: boolean;
  createPr: (input: CreatePrInput) => Promise<void>;
  setPrStatus: (pr: RepoPr, target: "open" | "closed" | "draft") => Promise<void>;
  addComment: (pr: RepoPr, content: string) => Promise<void>;
  error: string | null;
} {
  const { connection, connectionState, identity } = useRelay();
  const [prs, setPrs] = useState<RepoPr[]>([]);
  const [patches, setPatches] = useState<RepoPatch[]>([]);
  const [commentsByRoot, setCommentsByRoot] = useState<Record<string, RepoComment[]>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Latest status-event timestamp per root — for monotonic status writes. */
  const latestStatusAt = useRef(new Map<string, number>());

  useEffect(() => {
    if (!connection || connectionState !== "ready" || !owner || !repoName || !enabled) return;

    const coordinate = repoCoordinate(owner, repoName);
    const prMap = new Map<string, PrBase>();
    const updatesByRoot = new Map<string, PrUpdate[]>();
    const statusEvents: RootStatusEvent[] = [];
    const commentMap = new Map<string, RepoComment[]>();
    const patchMap = new Map<string, RepoPatch>();
    const seen = new Set<string>();

    function rebuild() {
      const list: RepoPr[] = [...prMap.values()].map((pr) => {
        const kind = resolveStatusKind(
          statusEvents.filter((s) => s.rootId === pr.id),
          new Set([pr.pubkey, owner]),
        );
        return {
          ...pr,
          status: prStatusFromKind(kind, pr.labels),
          // Trust rule (desktop parity): only updates signed by the PR author
          // or repo owner are rendered — anyone else can inject forged rows.
          updates: filterTrustedAuthors(
            updatesByRoot.get(pr.id) ?? [],
            new Set([pr.pubkey, owner]),
          ).sort((a, b) => a.createdAt - b.createdAt),
          commentCount: commentMap.get(pr.id)?.length ?? 0,
        };
      });
      list.sort((a, b) => b.createdAt - a.createdAt);
      setPrs(list);
      setPatches([...patchMap.values()].sort((a, b) => b.createdAt - a.createdAt));
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
        kinds: [KIND_PULL_REQUEST, KIND_PR_UPDATE, KIND_PATCH, KIND_COMMENT, ...STATUS_KINDS],
        "#a": [coordinate],
        limit: 500,
      },
      (ev: NostrEvent) => {
        if (seen.has(ev.id)) return;
        seen.add(ev.id);
        if (ev.kind === KIND_PULL_REQUEST) {
          prMap.set(ev.id, {
            id: ev.id,
            pubkey: ev.pubkey,
            subject: ev.tags.find((t) => t[0] === "subject")?.[1] ?? "(no title)",
            content: ev.content,
            tipCommit: ev.tags.find((t) => t[0] === "c")?.[1] ?? null,
            branchName: ev.tags.find((t) => t[0] === "branch-name")?.[1] ?? null,
            targetBranch: ev.tags.find((t) => t[0] === "target-branch")?.[1] ?? null,
            // Multi-value clone tags (desktop-compatible): every element
            // after the tag name is a URL.
            cloneUrls: ev.tags.filter((t) => t[0] === "clone").flatMap((t) => t.slice(1)),
            labels: ev.tags.filter((t) => t[0] === "t").map((t) => t[1]),
            createdAt: ev.created_at,
          });
        } else if (ev.kind === KIND_PR_UPDATE) {
          const rootId = rootIdOf(ev);
          if (rootId) {
            const list = updatesByRoot.get(rootId) ?? [];
            list.push({
              id: ev.id,
              pubkey: ev.pubkey,
              commit: ev.tags.find((t) => t[0] === "c")?.[1] ?? null,
              createdAt: ev.created_at,
            });
            updatesByRoot.set(rootId, list);
          }
        } else if (ev.kind === KIND_PATCH) {
          patchMap.set(ev.id, {
            id: ev.id,
            pubkey: ev.pubkey,
            content: ev.content,
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

  const createPr = useCallback(
    async (input: CreatePrInput) => {
      if (!identity) { setError("Sign in to create pull requests."); return; }
      const tags = [
        ["a", coordinate],
        ["p", owner],
        ["subject", input.subject],
        ["c", input.tipCommit],
        ["clone", input.cloneUrl],
        ["branch-name", input.branchName],
        ["target-branch", input.targetBranch],
      ];
      await publish(KIND_PULL_REQUEST, tags, input.content, "Failed to create pull request.");
    },
    [publish, coordinate, owner, identity],
  );

  const setPrStatus = useCallback(
    async (pr: RepoPr, target: "open" | "closed" | "draft") => {
      await publish(
        statusKindFor(target),
        statusTags(pr.id, pr.pubkey, owner, coordinate),
        "",
        "Failed to update pull request status.",
        monotonicCreatedAt(latestStatusAt.current.get(pr.id) ?? null),
      );
    },
    [publish, owner, coordinate],
  );

  const addComment = useCallback(
    async (pr: RepoPr, content: string) => {
      await publish(
        KIND_COMMENT,
        commentTags(pr.id, pr.pubkey, owner, coordinate),
        content,
        "Failed to post comment.",
      );
    },
    [publish, owner, coordinate],
  );

  return { prs, patches, commentsByRoot, isLoading, createPr, setPrStatus, addComment, error };
}
