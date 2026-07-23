import { useState } from "react";
import { Hash, Lock, Users, Zap, MessageSquare } from "lucide-react";
import { useRelay } from "@/shared/context/relay-context";
import { useMessages } from "../use-messages";
import { useSendMessage } from "../use-send-message";
import { MessageList } from "./MessageList";
import { MessageComposer } from "./MessageComposer";
import { ChannelMembersPanel } from "./ChannelMembersPanel";
import type { Channel, ChannelType } from "../types";

interface Props {
  channel: Channel;
}

function ChannelTypeIcon({ type, isPrivate }: { type: ChannelType; isPrivate: boolean }) {
  if (isPrivate) return <Lock className="h-4 w-4 text-black/40 dark:text-white/40" />;
  if (type === "workflow") return <Zap className="h-4 w-4 text-violet-500/70 dark:text-violet-400/70" />;
  if (type === "forum") return <MessageSquare className="h-4 w-4 text-black/40 dark:text-white/40" />;
  return <Hash className="h-4 w-4 text-black/40 dark:text-white/40" />;
}

export function ChannelView({ channel }: Props) {
  const { identity, connectionState } = useRelay();
  const { messages, isLoading, addOptimistic, fetchOlder, canFetchOlder } =
    useMessages(channel.groupId);
  const { send, isSending } = useSendMessage(channel.groupId, addOptimistic);
  const [membersPanelOpen, setMembersPanelOpen] = useState(false);

  const isReady = connectionState === "ready";

  return (
    <div className="flex min-w-0 flex-1 overflow-hidden">
      {/* Main chat column */}
      <div className="flex min-w-0 flex-1 flex-col bg-white dark:bg-[#111111]">
        {/* Channel header */}
        <div className="flex shrink-0 items-center gap-2 border-b border-black/10 px-4 py-3 dark:border-white/10">
          <ChannelTypeIcon type={channel.channelType} isPrivate={channel.isPrivate} />
          <h1 className="text-sm font-semibold text-black dark:text-white">
            {channel.name}
          </h1>

          {/* Model badge for workflow channels */}
          {channel.channelType === "workflow" && channel.model && (
            <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-medium text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
              {channel.model.split("-")[0]}
            </span>
          )}

          {channel.about && (
            <>
              <div className="h-3.5 w-px bg-black/15 dark:bg-white/15" />
              <p className="min-w-0 truncate text-xs text-black/50 dark:text-white/50">
                {channel.about}
              </p>
            </>
          )}

          {/* Members toggle */}
          <button
            type="button"
            onClick={() => setMembersPanelOpen((o) => !o)}
            title={membersPanelOpen ? "Hide members" : "Show members"}
            aria-pressed={membersPanelOpen}
            className={`ml-auto flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors ${
              membersPanelOpen
                ? "bg-black/10 text-black dark:bg-white/15 dark:text-white"
                : "text-black/40 hover:bg-black/5 hover:text-black/70 dark:text-white/40 dark:hover:bg-white/5 dark:hover:text-white/70"
            }`}
          >
            <Users className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Members</span>
          </button>
        </div>

        {/* Message timeline */}
        <MessageList
          messages={messages}
          myPubkey={identity?.pubkey}
          isLoading={isLoading}
          canFetchOlder={canFetchOlder}
          onFetchOlder={fetchOlder}
        />

        {/* Composer */}
        <MessageComposer
          channelName={channel.name}
          onSend={send}
          isSending={isSending}
          disabled={!isReady || !identity}
        />
      </div>

      {/* Members panel */}
      {membersPanelOpen && (
        <ChannelMembersPanel
          groupId={channel.groupId}
          channelName={channel.name}
          onClose={() => setMembersPanelOpen(false)}
        />
      )}
    </div>
  );
}
