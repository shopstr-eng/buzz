/**
 * Forum channels: kind 45001 posts + kind 45003 comments (Buzz-native,
 * h-scoped, MessagesWrite scope). Kind 45002 votes are not yet surfaced (delta).
 */

import { useCallback, useEffect, useState } from "react";
import { useRelay } from "@/shared/context/relay-context";
import { getSignFn } from "@/shared/lib/identity";
import type { NostrEvent } from "@/shared/lib/relay-connection";

export const KIND_FORUM_POST = 45001;
export const KIND_FORUM_VOTE = 45002;
export const KIND_FORUM_COMMENT = 45003;

export interface ForumPost {
  id: string;
  pubkey: string;
  content: string;
  createdAt: number;
  replyCount: number;
  lastReplyAt: number;
}

export interface ForumComment {
  id: string;
  pubkey: string;
  content: string;
  createdAt: number;
}

function parentPostId(ev: NostrEvent): string | undefined {
  return ev.tags.find((t) => t[0] === "e" && t[1])?.[1];
}

/** Post list for a forum channel (with reply counts from 45003 comments). */
export function useForumPosts(groupId: string): {
  posts: ForumPost[];
  isLoading: boolean;
} {
  const { connection, connectionState } = useRelay();
  const [posts, setPosts] = useState<ForumPost[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!connection || connectionState !== "ready") return;
    setPosts([]);
    setIsLoading(true);

    const postMap = new Map<string, ForumPost>();
    // Order-independent aggregation: comments can arrive before their parent
    // post in a mixed-kind subscription. Cache them and apply when the post
    // shows up; dedupe by comment id so replays can't overcount.
    const pendingComments = new Map<string, ForumComment[]>();
    const countedCommentIds = new Map<string, Set<string>>();

    const unsub = connection.subscribe(
      { kinds: [KIND_FORUM_POST, KIND_FORUM_COMMENT], "#h": [groupId], limit: 500 },
      (ev: NostrEvent) => {
        if (ev.kind === KIND_FORUM_POST) {
          const existing = postMap.get(ev.id);
          const cached = pendingComments.get(ev.id) ?? [];
          pendingComments.delete(ev.id);
          let replyCount = existing?.replyCount ?? 0;
          let lastReplyAt = existing?.lastReplyAt ?? ev.created_at;
          let counted = countedCommentIds.get(ev.id);
          if (!counted) {
            counted = new Set();
            countedCommentIds.set(ev.id, counted);
          }
          for (const c of cached) {
            if (counted.has(c.id)) continue;
            counted.add(c.id);
            replyCount += 1;
            lastReplyAt = Math.max(lastReplyAt, c.createdAt);
          }
          postMap.set(ev.id, {
            id: ev.id,
            pubkey: ev.pubkey,
            content: ev.content,
            createdAt: ev.created_at,
            replyCount,
            lastReplyAt,
          });
        } else {
          const pid = parentPostId(ev);
          if (!pid) return;
          const comment: ForumComment = {
            id: ev.id,
            pubkey: ev.pubkey,
            content: ev.content,
            createdAt: ev.created_at,
          };
          const post = postMap.get(pid);
          if (!post) {
            const list = pendingComments.get(pid) ?? [];
            if (!list.some((c) => c.id === comment.id)) list.push(comment);
            pendingComments.set(pid, list);
            return;
          }
          let counted = countedCommentIds.get(pid);
          if (!counted) {
            counted = new Set();
            countedCommentIds.set(pid, counted);
          }
          if (counted.has(comment.id)) return;
          counted.add(comment.id);
          postMap.set(pid, {
            ...post,
            replyCount: post.replyCount + 1,
            lastReplyAt: Math.max(post.lastReplyAt, ev.created_at),
          });
        }
        setPosts(
          [...postMap.values()].sort((a, b) => b.lastReplyAt - a.lastReplyAt),
        );
      },
      () => setIsLoading(false),
    );

    return unsub;
  }, [connection, connectionState, groupId]);

  return { posts, isLoading };
}

/** Comments for one forum post (flat, oldest first). */
export function useForumThread(
  groupId: string,
  postId: string,
): { comments: ForumComment[]; isLoading: boolean } {
  const { connection, connectionState } = useRelay();
  const [comments, setComments] = useState<ForumComment[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!connection || connectionState !== "ready") return;
    setComments([]);
    setIsLoading(true);
    const seen = new Map<string, ForumComment>();

    const unsub = connection.subscribe(
      { kinds: [KIND_FORUM_COMMENT], "#h": [groupId], "#e": [postId], limit: 500 },
      (ev: NostrEvent) => {
        if (parentPostId(ev) !== postId) return;
        seen.set(ev.id, {
          id: ev.id,
          pubkey: ev.pubkey,
          content: ev.content,
          createdAt: ev.created_at,
        });
        setComments([...seen.values()].sort((a, b) => a.createdAt - b.createdAt));
      },
      () => setIsLoading(false),
    );

    return unsub;
  }, [connection, connectionState, groupId, postId]);

  return { comments, isLoading };
}

/** Publish helpers. */
export function useForumActions(groupId: string): {
  createPost: (content: string, mentionPubkeys?: string[]) => Promise<void>;
  createComment: (postId: string, content: string, mentionPubkeys?: string[]) => Promise<void>;
} {
  const { connection } = useRelay();

  const publish = useCallback(
    async (kind: number, content: string, extraTags: string[][], mentionPubkeys?: string[]) => {
      if (!connection) return;
      const trimmed = content.trim();
      if (!trimmed) return;
      const signFn = getSignFn();
      if (!signFn) throw new Error("No signing key available. Please log in again.");
      const tags: string[][] = [["h", groupId], ...extraTags];
      for (const pk of mentionPubkeys ?? []) tags.push(["p", pk]);
      const signed = await signFn({
        kind,
        created_at: Math.floor(Date.now() / 1000),
        tags,
        content: trimmed,
      });
      connection.publish(signed);
    },
    [connection, groupId],
  );

  const createPost = useCallback(
    (content: string, mentionPubkeys?: string[]) =>
      publish(KIND_FORUM_POST, content, [], mentionPubkeys),
    [publish],
  );

  const createComment = useCallback(
    (postId: string, content: string, mentionPubkeys?: string[]) =>
      publish(KIND_FORUM_COMMENT, content, [["e", postId]], mentionPubkeys),
    [publish],
  );

  return { createPost, createComment };
}
