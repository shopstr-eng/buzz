import { Hash, Lock, Users } from "lucide-react";
import { useRelay } from "@/shared/context/relay-context";
import { useMessages } from "../use-messages";
import { useSendMessage } from "../use-send-message";
import { MessageList } from "./MessageList";
import { MessageComposer } from "./MessageComposer";
import type { Channel } from "../types";

interface Props {
  channel: Channel;
}

export function ChannelView({ channel }: Props) {
  const { identity, connectionState } = useRelay();
  const { messages, isLoading, addOptimistic, fetchOlder, canFetchOlder } =
    useMessages(channel.groupId);
  const { send, isSending } = useSendMessage(channel.groupId, addOptimistic);

  const isReady = connectionState === "ready";

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-white dark:bg-[#111111]">
      {/* Channel header */}
      <div className="flex shrink-0 items-center gap-2 border-b border-black/10 px-4 py-3 dark:border-white/10">
        {channel.isPrivate ? (
          <Lock className="h-4 w-4 text-black/40 dark:text-white/40" />
        ) : (
          <Hash className="h-4 w-4 text-black/40 dark:text-white/40" />
        )}
        <h1 className="text-sm font-semibold text-black dark:text-white">
          {channel.name}
        </h1>
        {channel.about && (
          <>
            <div className="h-3.5 w-px bg-black/15 dark:bg-white/15" />
            <p className="min-w-0 truncate text-xs text-black/50 dark:text-white/50">
              {channel.about}
            </p>
          </>
        )}
        <div className="ml-auto flex items-center gap-1.5 text-xs text-black/40 dark:text-white/40">
          <Users className="h-3.5 w-3.5" />
          <a
            href="/admin/"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-black/70 dark:hover:text-white/70"
          >
            Manage members
          </a>
        </div>
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
  );
}
