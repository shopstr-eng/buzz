/**
 * Issues tab for a repository: NIP-34 kind-1621 issues with status badges,
 * label chips, comment threads, a composer, and owner/author status actions
 * (reopen / done / close / triage via kind 1630–1633 events).
 */

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowLeft, CheckCircle, CircleDot, MessageSquare, Plus, X, XCircle, AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { relativeTime } from "@/shared/lib/relative-time";
import { useRelay } from "@/shared/context/relay-context";
import { PubkeyAvatar } from "./PubkeyAvatar";
import { useRepoIssues } from "../use-repo-issues";
import type { IssueStatus, RepoComment } from "../repo-collab";

const STATUS_CFG: Record<IssueStatus, { label: string; cls: string; Icon: React.ElementType }> = {
  open: { label: "Open", cls: "text-emerald-600 dark:text-emerald-400", Icon: CircleDot },
  done: { label: "Done", cls: "text-violet-600 dark:text-violet-400", Icon: CheckCircle },
  closed: { label: "Closed", cls: "text-black/40 dark:text-white/40", Icon: XCircle },
  triage: { label: "Triage", cls: "text-amber-600 dark:text-amber-400", Icon: AlertTriangle },
};

export function IssueStatusBadge({ status }: { status: IssueStatus }) {
  const { label, cls, Icon } = STATUS_CFG[status];
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${cls}`}>
      <Icon className="h-3.5 w-3.5" />
      {label}
    </span>
  );
}

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
              <p className="mb-1 text-[10px] text-black/35 dark:text-white/35">
                {relativeTime(c.createdAt)}
              </p>
              <p className="whitespace-pre-wrap break-words text-sm text-black/80 dark:text-white/80">
                {c.content}
              </p>
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

function NewIssueDialog({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (subject: string, content: string, labels: string[]) => Promise<void>;
}) {
  const [subject, setSubject] = useState("");
  const [content, setContent] = useState("");
  const [labels, setLabels] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleCreate() {
    if (!subject.trim()) return;
    setSaving(true);
    try {
      await onCreate(
        subject.trim(),
        content.trim(),
        labels.split(",").map((l) => l.trim()).filter(Boolean),
      );
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onMouseDown={onClose}>
      <div
        className="w-[28rem] rounded-xl border border-black/10 bg-white p-4 shadow-xl dark:border-white/10 dark:bg-[#1E1E1E]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-black dark:text-white">New issue</h2>
          <button type="button" onClick={onClose} aria-label="Close"
            className="text-black/30 hover:text-black/60 dark:text-white/30 dark:hover:text-white/60">
            <X className="h-4 w-4" />
          </button>
        </div>
        <input
          autoFocus type="text" value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Title"
          className="mb-2 w-full rounded-md border border-black/15 bg-transparent px-3 py-2 text-sm text-black outline-none focus:border-black/40 dark:border-white/15 dark:text-white dark:focus:border-white/40"
        />
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={5}
          placeholder="Description (markdown)"
          className="mb-2 w-full resize-y rounded-md border border-black/15 bg-transparent px-3 py-2 text-sm text-black outline-none placeholder-black/30 focus:border-black/40 dark:border-white/15 dark:text-white dark:placeholder-white/30 dark:focus:border-white/40"
        />
        <input
          type="text" value={labels}
          onChange={(e) => setLabels(e.target.value)}
          placeholder="Labels, comma separated (optional)"
          className="mb-3 w-full rounded-md border border-black/15 bg-transparent px-3 py-2 text-sm text-black outline-none placeholder-black/30 focus:border-black/40 dark:border-white/15 dark:text-white dark:placeholder-white/30 dark:focus:border-white/40"
        />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            type="button" onClick={handleCreate}
            disabled={saving || !subject.trim()}
            className="bg-black text-white hover:bg-black/80 dark:bg-white dark:text-black dark:hover:bg-white/90"
          >
            Create issue
          </Button>
        </div>
      </div>
    </div>
  );
}

export function RepoIssuesSection({ owner, repoName }: { owner: string; repoName: string }) {
  const { identity } = useRelay();
  const { issues, commentsByRoot, isLoading, createIssue, setIssueStatus, addComment, error } =
    useRepoIssues(owner, repoName, true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);

  const selected = issues.find((i) => i.id === selectedId) ?? null;
  const myPubkey = identity?.pubkey;

  if (selected) {
    const canChangeStatus = myPubkey === owner || myPubkey === selected.pubkey;
    return (
      <div className="mt-4">
        <button
          type="button"
          onClick={() => setSelectedId(null)}
          className="mb-3 inline-flex items-center gap-1 text-sm text-black/60 hover:text-black dark:text-white/60 dark:hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" /> Back to issues
        </button>

        <div className="flex items-center gap-2">
          <IssueStatusBadge status={selected.status} />
          <h2 className="text-lg font-semibold text-black dark:text-white">{selected.subject}</h2>
        </div>
        <p className="mt-1 text-xs text-black/40 dark:text-white/40">
          Opened {relativeTime(selected.createdAt)} · {selected.id.slice(0, 8)}
        </p>

        {selected.labels.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {selected.labels.map((l) => (
              <Badge key={l} variant="outline"
                className="border-black/15 text-black/60 dark:border-white/15 dark:text-white/60">
                {l}
              </Badge>
            ))}
          </div>
        )}

        {selected.content && (
          <div className="prose prose-sm mt-3 max-w-none rounded-lg border border-black/8 bg-white p-3 dark:prose-invert dark:border-white/8 dark:bg-white/5">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{selected.content}</ReactMarkdown>
          </div>
        )}

        {canChangeStatus && (
          <div className="mt-3 flex flex-wrap gap-2">
            {selected.status !== "open" && (
              <Button type="button" variant="outline" size="sm"
                onClick={() => setIssueStatus(selected, "open")}>Reopen</Button>
            )}
            {selected.status !== "done" && (
              <Button type="button" variant="outline" size="sm"
                onClick={() => setIssueStatus(selected, "resolved")}>Mark done</Button>
            )}
            {selected.status !== "closed" && (
              <Button type="button" variant="outline" size="sm"
                onClick={() => setIssueStatus(selected, "closed")}>Close</Button>
            )}
          </div>
        )}

        <CommentThread
          comments={commentsByRoot[selected.id] ?? []}
          onPost={(content) => addComment(selected, content)}
          canPost={Boolean(myPubkey)}
        />
      </div>
    );
  }

  return (
    <div className="mt-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs text-black/40 dark:text-white/40">
          {isLoading ? "Loading…" : `${issues.length} issue${issues.length === 1 ? "" : "s"}`}
        </p>
        {myPubkey && (
          <Button
            type="button" size="sm"
            onClick={() => setNewOpen(true)}
            className="bg-black text-white hover:bg-black/80 dark:bg-white dark:text-black dark:hover:bg-white/90"
          >
            <Plus className="h-3.5 w-3.5" /> New issue
          </Button>
        )}
      </div>

      {error && (
        <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-900/20 dark:text-red-400">
          {error}
        </p>
      )}

      {!isLoading && issues.length === 0 && (
        <p className="rounded-lg border border-dashed border-black/15 px-3 py-8 text-center text-sm text-black/40 dark:border-white/15 dark:text-white/40">
          No issues yet.
        </p>
      )}

      <div className="divide-y divide-black/5 rounded-lg border border-black/10 dark:divide-white/5 dark:border-white/10">
        {issues.map((issue) => (
          <button
            key={issue.id}
            type="button"
            onClick={() => setSelectedId(issue.id)}
            className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
          >
            <IssueStatusBadge status={issue.status} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-black dark:text-white">
                {issue.subject}
              </p>
              <p className="text-[11px] text-black/40 dark:text-white/40">
                {relativeTime(issue.createdAt)}
                {issue.labels.length > 0 && ` · ${issue.labels.join(", ")}`}
              </p>
            </div>
            {issue.commentCount > 0 && (
              <span className="flex shrink-0 items-center gap-1 text-[11px] text-black/40 dark:text-white/40">
                <MessageSquare className="h-3 w-3" />
                {issue.commentCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {newOpen && (
        <NewIssueDialog
          onClose={() => setNewOpen(false)}
          onCreate={async (subject, content, labels) => {
            await createIssue(subject, content, labels);
            toast.success("Issue published");
          }}
        />
      )}
    </div>
  );
}
