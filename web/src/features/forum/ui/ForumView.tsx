/**
 * Forum tab: post list + new-post composer; clicking a post opens its thread
 * (comments + reply composer) with a back button.
 */

import { useMemo, useState } from "react";
import { ArrowLeft, Loader, MessageSquare, Send } from "lucide-react";
import {
  useForumActions,
  useForumPosts,
  useForumThread,
  type ForumPost,
} from "../use-forum";
import { useProfiles } from "@/shared/hooks/use-profiles";
import { relativeTime } from "@/shared/lib/relative-time";
import type { Channel } from "../../channels/types";

function displayName(profiles: Map<string, { name?: string | null }>, pubkey: string): string {
  return profiles.get(pubkey)?.name ?? `${pubkey.slice(0, 4)}…${pubkey.slice(-4)}`;
}

function Composer({
  placeholder,
  submitLabel,
  onSubmit,
}: {
  placeholder: string;
  submitLabel: string;
  onSubmit: (content: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  async function handleSubmit() {
    if (!draft.trim() || sending) return;
    setSending(true);
    try {
      await onSubmit(draft);
      setDraft("");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex items-end gap-2 rounded-lg border border-black/10 p-2 dark:border-white/10">
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void handleSubmit();
          }
        }}
        placeholder={placeholder}
        rows={2}
        maxLength={4000}
        className="flex-1 resize-none bg-transparent px-1 py-0.5 text-sm text-black placeholder:text-black/35 focus:outline-none dark:text-white dark:placeholder:text-white/35"
      />
      <button
        type="button"
        onClick={() => void handleSubmit()}
        disabled={sending || !draft.trim()}
        aria-label={submitLabel}
        className="rounded-md bg-black p-1.5 text-white hover:opacity-80 disabled:opacity-30 dark:bg-white dark:text-black"
      >
        <Send className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function ThreadView({
  channel,
  post,
  onBack,
}: {
  channel: Channel;
  post: ForumPost;
  onBack: () => void;
}) {
  const { comments, isLoading } = useForumThread(channel.groupId, post.id);
  const { createComment } = useForumActions(channel.groupId);
  const pubkeys = useMemo(
    () => [post.pubkey, ...comments.map((c) => c.pubkey)],
    [post.pubkey, comments],
  );
  const profiles = useProfiles(pubkeys);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-2 border-b border-black/10 px-4 py-2 dark:border-white/10">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-black/50 hover:bg-black/5 hover:text-black dark:text-white/50 dark:hover:bg-white/5 dark:hover:text-white"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {/* The post itself */}
        <div className="mb-3 rounded-lg border border-black/10 px-3 py-2 dark:border-white/10">
          <div className="flex items-baseline gap-2">
            <span className="text-xs font-semibold text-black dark:text-white">
              {displayName(profiles, post.pubkey)}
            </span>
            <span className="text-[10px] text-black/35 dark:text-white/35">
              {relativeTime(post.createdAt)}
            </span>
          </div>
          <p className="mt-1 whitespace-pre-wrap text-sm text-black/80 dark:text-white/80">
            {post.content}
          </p>
        </div>

        {/* Comments */}
        {isLoading && comments.length === 0 ? (
          <p className="flex items-center justify-center gap-2 pt-6 text-xs text-black/35 dark:text-white/35">
            <Loader className="h-3.5 w-3.5 animate-spin" /> Loading comments…
          </p>
        ) : (
          <div className="space-y-0.5">
            {comments.map((c) => (
              <div key={c.id} className="rounded-lg px-3 py-2 hover:bg-black/5 dark:hover:bg-white/5">
                <div className="flex items-baseline gap-2">
                  <span className="text-xs font-semibold text-black dark:text-white">
                    {displayName(profiles, c.pubkey)}
                  </span>
                  <span className="text-[10px] text-black/35 dark:text-white/35">
                    {relativeTime(c.createdAt)}
                  </span>
                </div>
                <p className="mt-0.5 whitespace-pre-wrap text-xs text-black/70 dark:text-white/70">
                  {c.content}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="shrink-0 px-4 pb-3">
        <Composer
          placeholder="Write a comment…"
          submitLabel="Post comment"
          onSubmit={(content) => createComment(post.id, content)}
        />
      </div>
    </div>
  );
}

export function ForumView({ channel }: { channel: Channel }) {
  const { posts, isLoading } = useForumPosts(channel.groupId);
  const { createPost } = useForumActions(channel.groupId);
  const [selected, setSelected] = useState<ForumPost | null>(null);

  const profiles = useProfiles(posts.map((p) => p.pubkey));

  if (selected) {
    // Keep the freshest copy of the selected post (reply counts update live).
    const fresh = posts.find((p) => p.id === selected.id) ?? selected;
    return <ThreadView channel={channel} post={fresh} onBack={() => setSelected(null)} />;
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {isLoading && posts.length === 0 ? (
          <p className="flex items-center justify-center gap-2 pt-8 text-xs text-black/35 dark:text-white/35">
            <Loader className="h-3.5 w-3.5 animate-spin" /> Loading posts…
          </p>
        ) : posts.length === 0 ? (
          <p className="pt-8 text-center text-xs text-black/35 dark:text-white/35">
            No posts yet — start the discussion below.
          </p>
        ) : (
          <div className="space-y-1">
            {posts.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setSelected(p)}
                className="block w-full rounded-lg border border-black/10 px-3 py-2 text-left hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
              >
                <div className="flex items-baseline gap-2">
                  <span className="text-xs font-semibold text-black dark:text-white">
                    {displayName(profiles, p.pubkey)}
                  </span>
                  <span className="text-[10px] text-black/35 dark:text-white/35">
                    {relativeTime(p.createdAt)}
                  </span>
                  {p.replyCount > 0 && (
                    <span className="ml-auto flex items-center gap-1 text-[10px] text-black/40 dark:text-white/40">
                      <MessageSquare className="h-3 w-3" />
                      {p.replyCount}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 line-clamp-3 whitespace-pre-wrap text-xs text-black/70 dark:text-white/70">
                  {p.content}
                </p>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="shrink-0 px-4 pb-3">
        <Composer
          placeholder={`New post in ${channel.name}…`}
          submitLabel="Create post"
          onSubmit={(content) => createPost(content)}
        />
      </div>
    </div>
  );
}
