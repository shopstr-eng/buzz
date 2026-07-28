/**
 * Global message search (NIP-50 via the relay). Results grouped by channel;
 * clicking a hit opens that channel.
 */

import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { Hash, Loader, Lock, Search, Zap, MessageSquare } from "lucide-react";
import { useMessageSearch, type SearchHit } from "../use-search";
import { useChannels } from "../../channels/use-channels";
import type { Channel } from "../../channels/types";
import { useProfiles } from "@/shared/hooks/use-profiles";
import { relativeTime } from "@/shared/lib/relative-time";

function TypeIcon({ channel }: { channel?: Channel }) {
  if (!channel) return <Hash className="h-3.5 w-3.5 shrink-0 opacity-60" />;
  if (channel.isPrivate) return <Lock className="h-3.5 w-3.5 shrink-0 opacity-60" />;
  if (channel.channelType === "workflow") return <Zap className="h-3.5 w-3.5 shrink-0 text-violet-500 opacity-70 dark:text-violet-400" />;
  if (channel.channelType === "forum") return <MessageSquare className="h-3.5 w-3.5 shrink-0 opacity-60" />;
  return <Hash className="h-3.5 w-3.5 shrink-0 opacity-60" />;
}

function HitRow({
  hit,
  channelName,
  authorName,
}: {
  hit: SearchHit;
  channelName: string;
  authorName?: string;
}) {
  return (
    <Link
      to="/channels/$groupId"
      params={{ groupId: hit.groupId }}
      className="block rounded-lg px-3 py-2 hover:bg-black/5 dark:hover:bg-white/5"
    >
      <div className="flex items-baseline gap-2">
        <span className="text-xs font-semibold text-black dark:text-white">
          {authorName ?? `${hit.pubkey.slice(0, 4)}…${hit.pubkey.slice(-4)}`}
        </span>
        <span className="text-[10px] text-black/35 dark:text-white/35">
          {relativeTime(hit.createdAt)}
        </span>
        <span className="ml-auto truncate text-[10px] text-black/35 dark:text-white/35">
          in {channelName}
        </span>
      </div>
      <p className="mt-0.5 line-clamp-2 text-xs text-black/70 dark:text-white/70">
        {hit.content}
      </p>
    </Link>
  );
}

export function SearchView() {
  const { q } = useSearch({ strict: false }) as { q?: string };
  const query = q ?? "";
  const navigate = useNavigate();
  const [input, setInput] = useState(query);

  // Keep the input in sync when the URL changes (e.g. sidebar navigation).
  useEffect(() => setInput(query), [query]);

  const { results, isSearching } = useMessageSearch(query);
  const { channels } = useChannels();
  const channelById = useMemo(
    () => new Map(channels.map((c) => [c.groupId, c])),
    [channels],
  );

  const authorPubkeys = useMemo(
    () => [...new Set(results.map((r) => r.pubkey))],
    [results],
  );
  const profiles = useProfiles(authorPubkeys);

  const grouped = useMemo(() => {
    const map = new Map<string, SearchHit[]>();
    for (const hit of results) {
      const list = map.get(hit.groupId) ?? [];
      list.push(hit);
      map.set(hit.groupId, list);
    }
    return [...map.entries()];
  }, [results]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    void navigate({ to: "/channels/search", search: { q: input.trim() } });
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header + search form */}
      <div className="shrink-0 border-b border-black/10 px-4 py-3 dark:border-white/10">
        <form onSubmit={handleSubmit} className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-black/30 dark:text-white/30" />
            <input
              type="search"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Search messages…"
              autoFocus
              className="w-full rounded-lg border border-black/15 bg-transparent py-2 pl-9 pr-3 text-sm text-black placeholder:text-black/35 focus:border-black/30 focus:outline-none dark:border-white/15 dark:text-white dark:placeholder:text-white/35 dark:focus:border-white/30"
            />
          </div>
          {isSearching && (
            <Loader className="h-4 w-4 animate-spin text-black/30 dark:text-white/30" />
          )}
        </form>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {query.trim().length < 2 ? (
          <p className="pt-8 text-center text-xs text-black/35 dark:text-white/35">
            Type at least 2 characters to search all channels.
          </p>
        ) : !isSearching && results.length === 0 ? (
          <p className="pt-8 text-center text-xs text-black/35 dark:text-white/35">
            No messages match “{query}”.
          </p>
        ) : (
          <div className="space-y-4">
            {grouped.map(([groupId, hits]) => {
              const channel = channelById.get(groupId);
              const channelName = channel?.name ?? groupId;
              return (
                <div key={groupId}>
                  <div className="mb-1 flex items-center gap-1.5 px-3 text-[11px] font-semibold uppercase tracking-widest text-black/40 dark:text-white/40">
                    <TypeIcon channel={channel} />
                    {channelName}
                  </div>
                  {hits.map((hit) => (
                    <HitRow
                      key={hit.id}
                      hit={hit}
                      channelName={channelName}
                      authorName={profiles.get(hit.pubkey)?.name ?? undefined}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
