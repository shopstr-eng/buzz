/**
 * Dialog for announcing a new repository to the community.
 *
 * Publishes a NIP-34 kind-30617 "Repository Announcement" event to the relay.
 * The relay picks this up, reserves the repo name, and seeds an empty
 * object-store manifest so `git push` can target it immediately.
 */

import { useState, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { X, GitBranch, Hash } from "lucide-react";
import { toast } from "sonner";
import { useRelay } from "@/shared/context/relay-context";
import { getSignFn } from "@/shared/lib/identity";
import { relayHttpBaseUrl } from "@/shared/lib/relay-url";
import { useChannels } from "@/features/channels/use-channels";

const KIND_REPO_ANNOUNCEMENT = 30617;

/** Convert a display name to a URL-safe slug used as the `d` tag. */
function toSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

interface Props {
  onClose: () => void;
}

export function CreateRepoDialog({ onClose }: Props) {
  const { connection, identity } = useRelay();
  const { channels } = useChannels();
  const queryClient = useQueryClient();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [channelId, setChannelId] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const slug = useMemo(() => toSlug(name), [name]);
  const cloneUrl = slug
    ? `${relayHttpBaseUrl()}/git/${slug}/`
    : "";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!slug) return;

    if (!connection || !identity) {
      setError("Not connected to relay.");
      return;
    }
    const signFn = getSignFn();
    if (!signFn) {
      setError("No signing key available. Please log in again.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const now = Math.floor(Date.now() / 1000);
      const tags: string[][] = [
        ["d", slug],
        ["name", name.trim()],
        ["clone", cloneUrl],
        ["web", cloneUrl],
      ];
      if (description.trim()) {
        tags.push(["description", description.trim()]);
      }
      if (channelId) {
        tags.push(["buzz-channel", channelId]);
      }

      const signed = await signFn({
        kind: KIND_REPO_ANNOUNCEMENT,
        created_at: now,
        tags,
        content: description.trim(),
      });

      connection.publish(signed);

      // Invalidate so the list refreshes after the relay processes the event.
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["repos"] });
      }, 1500);

      toast.success(`Repository "${name.trim()}" announced`, {
        description: `Push to it with: git remote add buzz ${cloneUrl}`,
        duration: 8000,
      });
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to announce repository.",
      );
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm dark:bg-black/60"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-xl bg-white shadow-xl dark:bg-[#1E1E1E]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-black/10 px-5 py-4 dark:border-white/10">
          <h2 className="text-sm font-semibold text-black dark:text-white">
            New repository
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-black/30 transition-colors hover:bg-black/10 hover:text-black/60 dark:text-white/30 dark:hover:bg-white/10 dark:hover:text-white/60"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit}>
          <div className="space-y-4 p-5">
            {/* Name */}
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-black/60 dark:text-white/60">
                Repository name <span className="text-red-500">*</span>
              </label>
              <input
                autoFocus
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="my-project"
                className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm text-black placeholder-black/30 outline-none focus:border-black/40 dark:border-white/15 dark:bg-[#222] dark:text-white dark:placeholder-white/30 dark:focus:border-white/40"
              />
              {slug && slug !== name.trim().toLowerCase() && (
                <p className="mt-1 flex items-center gap-1 text-[11px] text-black/40 dark:text-white/40">
                  <Hash className="h-3 w-3" />
                  Slug: <span className="font-mono">{slug}</span>
                </p>
              )}
            </div>

            {/* Description */}
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-black/60 dark:text-white/60">
                Description{" "}
                <span className="font-normal text-black/30 dark:text-white/30">
                  (optional)
                </span>
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What is this repository for?"
                rows={2}
                className="w-full resize-none rounded-md border border-black/15 bg-white px-3 py-2 text-sm text-black placeholder-black/30 outline-none focus:border-black/40 dark:border-white/15 dark:bg-[#222] dark:text-white dark:placeholder-white/30 dark:focus:border-white/40"
              />
            </div>

            {/* Channel binding */}
            {channels.length > 0 && (
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-black/60 dark:text-white/60">
                  Link to channel{" "}
                  <span className="font-normal text-black/30 dark:text-white/30">
                    (optional)
                  </span>
                </label>
                <select
                  value={channelId}
                  onChange={(e) => setChannelId(e.target.value)}
                  className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm text-black outline-none focus:border-black/40 dark:border-white/15 dark:bg-[#222] dark:text-white dark:focus:border-white/40"
                >
                  <option value="">— none —</option>
                  {channels.map((ch) => (
                    <option key={ch.groupId} value={ch.groupId}>
                      #{ch.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Clone URL preview */}
            {cloneUrl && (
              <div className="rounded-md bg-black/4 px-3 py-2.5 dark:bg-white/5">
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-black/40 dark:text-white/40">
                  Clone URL
                </p>
                <div className="flex items-center gap-2">
                  <GitBranch className="h-3.5 w-3.5 shrink-0 text-black/40 dark:text-white/40" />
                  <code className="min-w-0 break-all text-[11px] text-black/70 dark:text-white/70">
                    {cloneUrl}
                  </code>
                </div>
              </div>
            )}

            {error && (
              <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-900/20 dark:text-red-400">
                {error}
              </p>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 border-t border-black/10 px-5 py-3.5 dark:border-white/10">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-4 py-2 text-sm text-black/50 transition-colors hover:bg-black/5 hover:text-black dark:text-white/50 dark:hover:bg-white/5 dark:hover:text-white"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!slug || submitting}
              className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-black/80 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-black dark:hover:bg-white/90"
            >
              {submitting ? "Creating…" : "Create repository"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
