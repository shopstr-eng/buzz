/**
 * Home / inbox: mentions across all channels + the Pulse feed (kind:1 notes).
 */

import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { AtSign, Loader, Radio, Send } from "lucide-react";
import { useMentions } from "../use-mentions";
import { usePulse } from "../use-pulse";
import { useChannels } from "../../channels/use-channels";
import { useRelay } from "@/shared/context/relay-context";
import { useProfiles } from "@/shared/hooks/use-profiles";
import { relativeTime } from "@/shared/lib/relative-time";

type Tab = "mentions" | "pulse";

function MentionsTab() {
  const { mentions, isLoading } = useMentions();
  const { channels } = useChannels();
  const channelNames = useMemo(
    () => new Map(channels.map((c) => [c.groupId, c.name])),
    [channels],
  );
  const authorPubkeys = useMemo(
    () => [...new Set(mentions.map((m) => m.pubkey))],
    [mentions],
  );
  const profiles = useProfiles(authorPubkeys);

  if (isLoading && mentions.length === 0) {
    return (
      <p className="flex items-center justify-center gap-2 pt-8 text-xs text-black/35 dark:text-white/35">
        <Loader className="h-3.5 w-3.5 animate-spin" /> Loading mentions…
      </p>
    );
  }
  if (mentions.length === 0) {
    return (
      <p className="pt-8 text-center text-xs text-black/35 dark:text-white/35">
        No mentions yet — you’ll see messages that @-mention you here.
      </p>
    );
  }

  return (
    <div className="space-y-0.5">
      {mentions.map((m) => (
        <Link
          key={m.id}
          to="/channels/$groupId"
          params={{ groupId: m.groupId }}
          className="block rounded-lg px-3 py-2 hover:bg-black/5 dark:hover:bg-white/5"
        >
          <div className="flex items-baseline gap-2">
            <span className="text-xs font-semibold text-black dark:text-white">
              {profiles.get(m.pubkey)?.name ?? `${m.pubkey.slice(0, 4)}…${m.pubkey.slice(-4)}`}
            </span>
            <span className="text-[10px] text-black/35 dark:text-white/35">
              {relativeTime(m.createdAt)}
            </span>
            <span className="ml-auto truncate text-[10px] text-black/35 dark:text-white/35">
              in {channelNames.get(m.groupId) ?? m.groupId}
            </span>
          </div>
          <p className="mt-0.5 line-clamp-2 text-xs text-black/70 dark:text-white/70">
            {m.content}
          </p>
        </Link>
      ))}
    </div>
  );
}

function PulseTab() {
  const { notes, isLoading, postNote } = usePulse();
  const { identity } = useRelay();
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);

  const authorPubkeys = useMemo(
    () => [...new Set(notes.map((n) => n.pubkey))],
    [notes],
  );
  const profiles = useProfiles(authorPubkeys);

  async function handlePost() {
    if (!draft.trim() || posting) return;
    setPosting(true);
    try {
      await postNote(draft);
      setDraft("");
    } finally {
      setPosting(false);
    }
  }

  return (
    <div>
      {identity && (
        <div className="mb-3 flex items-end gap-2 rounded-lg border border-black/10 p-2 dark:border-white/10">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handlePost();
              }
            }}
            placeholder="Post to the Pulse…"
            rows={2}
            maxLength={500}
            className="flex-1 resize-none bg-transparent px-1 py-0.5 text-sm text-black placeholder:text-black/35 focus:outline-none dark:text-white dark:placeholder:text-white/35"
          />
          <button
            type="button"
            onClick={() => void handlePost()}
            disabled={posting || !draft.trim()}
            aria-label="Post note"
            className="rounded-md bg-black p-1.5 text-white hover:opacity-80 disabled:opacity-30 dark:bg-white dark:text-black"
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {isLoading && notes.length === 0 ? (
        <p className="flex items-center justify-center gap-2 pt-8 text-xs text-black/35 dark:text-white/35">
          <Loader className="h-3.5 w-3.5 animate-spin" /> Loading the Pulse…
        </p>
      ) : notes.length === 0 ? (
        <p className="pt-8 text-center text-xs text-black/35 dark:text-white/35">
          Nothing on the Pulse yet — be the first to post.
        </p>
      ) : (
        <div className="space-y-0.5">
          {notes.map((n) => (
            <div key={n.id} className="rounded-lg px-3 py-2 hover:bg-black/5 dark:hover:bg-white/5">
              <div className="flex items-baseline gap-2">
                <span className="text-xs font-semibold text-black dark:text-white">
                  {profiles.get(n.pubkey)?.name ?? `${n.pubkey.slice(0, 4)}…${n.pubkey.slice(-4)}`}
                </span>
                <span className="text-[10px] text-black/35 dark:text-white/35">
                  {relativeTime(n.createdAt)}
                </span>
              </div>
              <p className="mt-0.5 whitespace-pre-wrap text-xs text-black/70 dark:text-white/70">
                {n.content}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function HomeView() {
  const [tab, setTab] = useState<Tab>("mentions");

  const tabCls = (t: Tab) =>
    `flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
      tab === t
        ? "bg-black/10 text-black dark:bg-white/15 dark:text-white"
        : "text-black/50 hover:bg-black/5 hover:text-black dark:text-white/50 dark:hover:bg-white/5 dark:hover:text-white"
    }`;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-1 border-b border-black/10 px-4 py-2.5 dark:border-white/10">
        <h1 className="mr-2 text-sm font-semibold text-black dark:text-white">Home</h1>
        <button type="button" onClick={() => setTab("mentions")} className={tabCls("mentions")}>
          <AtSign className="h-3.5 w-3.5" /> Mentions
        </button>
        <button type="button" onClick={() => setTab("pulse")} className={tabCls("pulse")}>
          <Radio className="h-3.5 w-3.5" /> Pulse
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {tab === "mentions" ? <MentionsTab /> : <PulseTab />}
      </div>
    </div>
  );
}
