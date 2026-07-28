/**
 * Pull requests tab for a repository: NIP-34 kind-1618 PRs with status
 * badges, branch/commit info, updates timeline (1619), comment threads with
 * review marks, standalone patches (1617) rendered with diff coloring, and
 * owner/author status actions (close/reopen/draft).
 *
 * Merging is intentionally absent — the desktop merges via a Tauri git
 * command; the web has no git-write path.
 */

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowLeft, CircleDot, FileDiff, GitMerge,
  MessageSquare, Pencil, Plus, X, XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/shared/ui/button";
import { relativeTime } from "@/shared/lib/relative-time";
import { useRelay } from "@/shared/context/relay-context";
import { PubkeyAvatar } from "./PubkeyAvatar";
import { useRepoPrs, type CreatePrInput, type RepoPr, type RepoPatch } from "../use-repo-prs";
import type { PrStatus, RepoComment } from "../repo-collab";

const STATUS_CFG: Record<PrStatus, { label: string; cls: string; Icon: React.ElementType }> = {
  open: { label: "Open", cls: "text-emerald-600 dark:text-emerald-400", Icon: CircleDot },
  merged: { label: "Merged", cls: "text-violet-600 dark:text-violet-400", Icon: GitMerge },
  closed: { label: "Closed", cls: "text-black/40 dark:text-white/40", Icon: XCircle },
  draft: { label: "Draft", cls: "text-amber-600 dark:text-amber-400", Icon: Pencil },
};

function PrStatusBadge({ status }: { status: PrStatus }) {
  const { label, cls, Icon } = STATUS_CFG[status];
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${cls}`}>
      <Icon className="h-3.5 w-3.5" />
      {label}
    </span>
  );
}

/** Minimal diff renderer for standalone patches: +/- line coloring. */
function DiffView({ patch }: { patch: string }) {
  return (
    <pre className="overflow-x-auto rounded-lg border border-black/8 bg-white p-3 font-mono text-[11px] leading-relaxed dark:border-white/8 dark:bg-[#111]">
      {patch.split("\n").map((line, i) => {
        let cls = "text-black/70 dark:text-white/70";
        if (line.startsWith("+") && !line.startsWith("+++")) {
          cls = "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400";
        } else if (line.startsWith("-") && !line.startsWith("---")) {
          cls = "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400";
        } else if (line.startsWith("@@")) {
          cls = "text-blue-600 dark:text-blue-400";
        } else if (line.startsWith("diff ") || line.startsWith("index ")) {
          cls = "text-black/40 dark:text-white/40";
        }
        return (
          <div key={i} className={cls}>
            {line || " "}
          </div>
        );
      })}
    </pre>
  );
}

const REVIEW_BADGE: Record<string, { label: string; cls: string }> = {
  approval: { label: "Approved", cls: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" },
  "changes-requested": { label: "Changes requested", cls: "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300" },
  "review-request": { label: "Review requested", cls: "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" },
};

function CommentThread({
  comments,
  onPost,
  canPost,
}: {
  comments: RepoComment[];
  onPost: (content: string) => Promise<void>;
  canPost: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);

  async function handlePost() {
    if (!draft.trim()) return;
    setPosting(true);
    try {
      await onPost(draft.trim());
      setDraft("");
    } finally {
      setPosting(false);
    }
  }

  return (
    <div className="mt-4">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-black/40 dark:text-white/40">
        Comments ({comments.length})
      </h3>
      <div className="space-y-3">
        {comments.map((c) => (
          <div key={c.id} className="flex gap-2">
            <PubkeyAvatar pubkey={c.pubkey} size="sm" />
            <div className="min-w-0 flex-1 rounded-lg border border-black/8 bg-white px-3 py-2 dark:border-white/8 dark:bg-white/5">
              <div className="mb-1 flex items-center gap-2">
                <p className="text-[10px] text-black/35 dark:text-white/35">
                  {relativeTime(c.createdAt)}
                </p>
                {c.review && (
                  <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${REVIEW_BADGE[c.review].cls}`}>
                    {REVIEW_BADGE[c.review].label}
                  </span>
                )}
                {c.inline && (
                  <span className="rounded bg-black/5 px-1 py-0.5 font-mono text-[9px] text-black/50 dark:bg-white/10 dark:text-white/50">
                    {c.inline.file}{c.inline.line ? `:${c.inline.line}` : ""}
                  </span>
                )}
              </div>
              {c.content && (
                <p className="whitespace-pre-wrap break-words text-sm text-black/80 dark:text-white/80">
                  {c.content}
                </p>
              )}
            </div>
          </div>
        ))}
        {comments.length === 0 && (
          <p className="text-xs text-black/35 dark:text-white/35">No comments yet.</p>
        )}
      </div>

      {canPost && (
        <div className="mt-3 flex gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={2}
            placeholder="Write a comment…"
            className="flex-1 resize-y rounded-md border border-black/15 bg-white px-3 py-2 text-sm text-black outline-none placeholder-black/30 focus:border-black/40 dark:border-white/15 dark:bg-white/5 dark:text-white dark:placeholder-white/30 dark:focus:border-white/40"
          />
          <Button
            type="button"
            onClick={handlePost}
            disabled={posting || !draft.trim()}
            className="self-end bg-black text-white hover:bg-black/80 dark:bg-white dark:text-black dark:hover:bg-white/90"
          >
            Post
          </Button>
        </div>
      )}
    </div>
  );
}

function NewPrDialog({
  defaultTarget,
  onClose,
  onCreate,
}: {
  defaultTarget: string;
  onClose: () => void;
  onCreate: (input: CreatePrInput) => Promise<void>;
}) {
  const [subject, setSubject] = useState("");
  const [content, setContent] = useState("");
  const [branchName, setBranchName] = useState("");
  const [targetBranch, setTargetBranch] = useState(defaultTarget);
  const [tipCommit, setTipCommit] = useState("");
  const [cloneUrl, setCloneUrl] = useState("");
  const [saving, setSaving] = useState(false);

  const valid = subject.trim() && branchName.trim() && targetBranch.trim() && tipCommit.trim() && cloneUrl.trim();

  async function handleCreate() {
    if (!valid) return;
    setSaving(true);
    try {
      await onCreate({
        subject: subject.trim(),
        content: content.trim(),
        branchName: branchName.trim(),
        targetBranch: targetBranch.trim(),
        tipCommit: tipCommit.trim(),
        cloneUrl: cloneUrl.trim(),
      });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  const inputCls =
    "w-full rounded-md border border-black/15 bg-transparent px-3 py-2 text-sm text-black outline-none placeholder-black/30 focus:border-black/40 dark:border-white/15 dark:text-white dark:placeholder-white/30 dark:focus:border-white/40";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onMouseDown={onClose}>
      <div
        className="max-h-[85vh] w-[30rem] overflow-y-auto rounded-xl border border-black/10 bg-white p-4 shadow-xl dark:border-white/10 dark:bg-[#1E1E1E]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-black dark:text-white">New pull request</h2>
          <button type="button" onClick={onClose} aria-label="Close"
            className="text-black/30 hover:text-black/60 dark:text-white/30 dark:hover:text-white/60">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-2">
          <input autoFocus type="text" value={subject} onChange={(e) => setSubject(e.target.value)}
            placeholder="Title" className={inputCls} />
          <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={4}
            placeholder="Description (markdown)" className={`${inputCls} resize-y`} />
          <div className="flex gap-2">
            <input type="text" value={branchName} onChange={(e) => setBranchName(e.target.value)}
              placeholder="Source branch" className={inputCls} />
            <input type="text" value={targetBranch} onChange={(e) => setTargetBranch(e.target.value)}
              placeholder="Target branch" className={inputCls} />
          </div>
          <input type="text" value={tipCommit} onChange={(e) => setTipCommit(e.target.value)}
            placeholder="Tip commit hash (c tag)" className={`${inputCls} font-mono text-xs`} />
          <input type="text" value={cloneUrl} onChange={(e) => setCloneUrl(e.target.value)}
            placeholder="Clone URL of your fork/branch" className={`${inputCls} font-mono text-xs`} />
        </div>
        <p className="mt-2 text-[11px] text-black/40 dark:text-white/40">
          Push your branch somewhere reachable first — reviewers fetch it via the clone URL.
        </p>
        <div className="mt-3 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="button" onClick={handleCreate} disabled={saving || !valid}
            className="bg-black text-white hover:bg-black/80 dark:bg-white dark:text-black dark:hover:bg-white/90">
            Create pull request
          </Button>
        </div>
      </div>
    </div>
  );
}

function PrDetail({
  pr,
  comments,
  isOwner,
  isAuthor,
  canPost,
  onBack,
  onStatus,
  onComment,
}: {
  pr: RepoPr;
  comments: RepoComment[];
  isOwner: boolean;
  isAuthor: boolean;
  canPost: boolean;
  onBack: () => void;
  onStatus: (target: "open" | "closed" | "draft") => Promise<void>;
  onComment: (content: string) => Promise<void>;
}) {
  const [tab, setTab] = useState<"conversation" | "commits">("conversation");
  const canChangeStatus = isOwner || isAuthor;

  return (
    <div className="mt-4">
      <button type="button" onClick={onBack}
        className="mb-3 inline-flex items-center gap-1 text-sm text-black/60 hover:text-black dark:text-white/60 dark:hover:text-white">
        <ArrowLeft className="h-4 w-4" /> Back to pull requests
      </button>

      <div className="flex items-center gap-2">
        <PrStatusBadge status={pr.status} />
        <h2 className="text-lg font-semibold text-black dark:text-white">{pr.subject}</h2>
      </div>
      <p className="mt-1 text-xs text-black/40 dark:text-white/40">
        {pr.branchName && pr.targetBranch
          ? `${pr.branchName} → ${pr.targetBranch} · `
          : ""}
        Opened {relativeTime(pr.createdAt)} · {pr.id.slice(0, 8)}
      </p>

      {/* Sub-tabs */}
      <div className="mt-3 flex gap-1 border-b border-black/10 dark:border-white/10">
        {(["conversation", "commits"] as const).map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)}
            className={`px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
              tab === t
                ? "border-b-2 border-black text-black dark:border-white dark:text-white"
                : "text-black/50 hover:text-black dark:text-white/50 dark:hover:text-white"
            }`}>
            {t}
          </button>
        ))}
      </div>

      {tab === "conversation" && (
        <>
          {pr.content && (
            <div className="prose prose-sm mt-3 max-w-none rounded-lg border border-black/8 bg-white p-3 dark:prose-invert dark:border-white/8 dark:bg-white/5">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{pr.content}</ReactMarkdown>
            </div>
          )}

          {pr.updates.length > 0 && (
            <div className="mt-3">
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-black/40 dark:text-white/40">
                Updates
              </h3>
              <div className="space-y-1">
                {pr.updates.map((u) => (
                  <p key={u.id} className="text-[11px] text-black/50 dark:text-white/50">
                    <span className="font-mono">{u.commit ? u.commit.slice(0, 8) : u.id.slice(0, 8)}</span>
                    {" "}pushed · {relativeTime(u.createdAt)}
                  </p>
                ))}
              </div>
            </div>
          )}

          {canChangeStatus && (
            <div className="mt-3 flex flex-wrap gap-2">
              {pr.status !== "open" && (
                <Button type="button" variant="outline" size="sm" onClick={() => onStatus("open")}>Reopen</Button>
              )}
              {pr.status === "open" && (
                <Button type="button" variant="outline" size="sm" onClick={() => onStatus("draft")}>Mark draft</Button>
              )}
              {pr.status !== "closed" && pr.status !== "merged" && (
                <Button type="button" variant="outline" size="sm" onClick={() => onStatus("closed")}>Close</Button>
              )}
            </div>
          )}

          <CommentThread comments={comments} onPost={onComment} canPost={canPost} />
        </>
      )}

      {tab === "commits" && (
        <div className="mt-3 space-y-1">
          {pr.tipCommit && (
            <div className="flex items-center gap-2 rounded-lg border border-black/8 bg-white px-3 py-2 dark:border-white/8 dark:bg-white/5">
              <code className="rounded bg-black/5 px-1.5 py-0.5 font-mono text-[11px] text-violet-700 dark:bg-white/10 dark:text-violet-300">
                {pr.tipCommit.slice(0, 10)}
              </code>
              <span className="text-[11px] text-black/40 dark:text-white/40">tip commit</span>
            </div>
          )}
          {pr.updates.filter((u) => u.commit).map((u) => (
            <div key={u.id} className="flex items-center gap-2 rounded-lg border border-black/8 bg-white px-3 py-2 dark:border-white/8 dark:bg-white/5">
              <code className="rounded bg-black/5 px-1.5 py-0.5 font-mono text-[11px] text-black/70 dark:bg-white/10 dark:text-white/70">
                {u.commit!.slice(0, 10)}
              </code>
              <span className="text-[11px] text-black/40 dark:text-white/40">{relativeTime(u.createdAt)}</span>
            </div>
          ))}
          {!pr.tipCommit && pr.updates.length === 0 && (
            <p className="text-xs text-black/35 dark:text-white/35">No commits recorded.</p>
          )}
        </div>
      )}
    </div>
  );
}

export function RepoPrsSection({
  owner,
  repoName,
  defaultBranch,
}: {
  owner: string;
  repoName: string;
  defaultBranch: string;
}) {
  const { identity } = useRelay();
  const { prs, patches, commentsByRoot, isLoading, createPr, setPrStatus, addComment, error } =
    useRepoPrs(owner, repoName, true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [showPatches, setShowPatches] = useState(false);

  const selected = prs.find((p) => p.id === selectedId) ?? null;
  const myPubkey = identity?.pubkey;

  if (selected) {
    return (
      <PrDetail
        pr={selected}
        comments={commentsByRoot[selected.id] ?? []}
        isOwner={myPubkey === owner}
        isAuthor={myPubkey === selected.pubkey}
        canPost={Boolean(myPubkey)}
        onBack={() => setSelectedId(null)}
        onStatus={(target) => setPrStatus(selected, target)}
        onComment={(content) => addComment(selected, content)}
      />
    );
  }

  return (
    <div className="mt-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs text-black/40 dark:text-white/40">
          {isLoading
            ? "Loading…"
            : `${prs.length} pull request${prs.length === 1 ? "" : "s"}${patches.length > 0 ? ` · ${patches.length} patch${patches.length === 1 ? "" : "es"}` : ""}`}
        </p>
        {myPubkey && (
          <Button type="button" size="sm" onClick={() => setNewOpen(true)}
            className="bg-black text-white hover:bg-black/80 dark:bg-white dark:text-black dark:hover:bg-white/90">
            <Plus className="h-3.5 w-3.5" /> New pull request
          </Button>
        )}
      </div>

      {error && (
        <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-900/20 dark:text-red-400">
          {error}
        </p>
      )}

      {!isLoading && prs.length === 0 && patches.length === 0 && (
        <p className="rounded-lg border border-dashed border-black/15 px-3 py-8 text-center text-sm text-black/40 dark:border-white/15 dark:text-white/40">
          No pull requests yet.
        </p>
      )}

      <div className="divide-y divide-black/5 rounded-lg border border-black/10 dark:divide-white/5 dark:border-white/10">
        {prs.map((pr) => (
          <button key={pr.id} type="button" onClick={() => setSelectedId(pr.id)}
            className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.04]">
            <PrStatusBadge status={pr.status} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-black dark:text-white">{pr.subject}</p>
              <p className="text-[11px] text-black/40 dark:text-white/40">
                {pr.branchName && pr.targetBranch ? `${pr.branchName} → ${pr.targetBranch} · ` : ""}
                {relativeTime(pr.createdAt)}
              </p>
            </div>
            {pr.commentCount > 0 && (
              <span className="flex shrink-0 items-center gap-1 text-[11px] text-black/40 dark:text-white/40">
                <MessageSquare className="h-3 w-3" />
                {pr.commentCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Standalone patches */}
      {patches.length > 0 && (
        <div className="mt-4">
          <button type="button" onClick={() => setShowPatches((s) => !s)}
            className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-black/40 hover:text-black/60 dark:text-white/40 dark:hover:text-white/60">
            <FileDiff className="h-3.5 w-3.5" />
            Patches ({patches.length})
          </button>
          {showPatches && (
            <div className="space-y-3">
              {patches.map((patch: RepoPatch) => (
                <div key={patch.id}>
                  <p className="mb-1 text-[11px] text-black/40 dark:text-white/40">
                    {relativeTime(patch.createdAt)} · {patch.id.slice(0, 8)}
                  </p>
                  <DiffView patch={patch.content} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {newOpen && (
        <NewPrDialog
          defaultTarget={defaultBranch}
          onClose={() => setNewOpen(false)}
          onCreate={async (input) => {
            await createPr(input);
            toast.success("Pull request published");
          }}
        />
      )}
    </div>
  );
}
