import { useEffect, useMemo, useState } from "react";
import { Hash, Lock, Settings, Users, Zap, MessageSquare } from "lucide-react";
import { useRelay } from "@/shared/context/relay-context";
import { useMessages } from "../use-messages";
import { useSendMessage } from "../use-send-message";
import { useMessageActions } from "../use-message-actions";
import { markChannelRead } from "../use-read-state";
import { useTypingBroadcast, useTypingIndicator } from "../use-typing";
import { useChannelMembers } from "../use-channel-members";
import { useReactions } from "../use-reactions";
import { useCustomEmoji } from "../use-custom-emoji";
import { useProfiles } from "@/shared/hooks/use-profiles";
import { MessageList } from "./MessageList";
import { MessageComposer } from "./MessageComposer";
import { ChannelMembersPanel } from "./ChannelMembersPanel";
import { ChannelSettingsDialog } from "./ChannelSettingsDialog";
import { ThreadPanel } from "./ThreadPanel";
import { WorkflowChannelView } from "./WorkflowChannelView";
import type { Channel, ChannelType, ChatMessage } from "../types";

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
  if (channel.channelType === "workflow") {
    return <WorkflowChannelView channel={channel} />;
  }
  return <ChatChannelView channel={channel} />;
}

function ChatChannelView({ channel }: Props) {
  const { identity, connectionState } = useRelay();
  const {
    messages,
    isLoading,
    addOptimistic,
    applyLocalEdit,
    applyLocalDelete,
    fetchOlder,
    canFetchOlder,
  } = useMessages(channel.groupId);
  const { send, isSending } = useSendMessage(channel.groupId, addOptimistic);
  const { editMessage, deleteMessage } = useMessageActions(
    channel.groupId,
    applyLocalEdit,
    applyLocalDelete,
  );
  const { members } = useChannelMembers(channel.groupId);
  const { reactions, addReaction } = useReactions(channel.groupId, identity?.pubkey);
  const { customEmoji, customEmojiUrls } = useCustomEmoji();
  const [membersPanelOpen, setMembersPanelOpen] = useState(false);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const [threadRoot, setThreadRoot] = useState<ChatMessage | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const typingPubkeys = useTypingIndicator(channel.groupId);
  const notifyTyping = useTypingBroadcast(channel.groupId);

  // Fetch profiles for all members so the mention picker shows display names.
  const memberPubkeys = useMemo(() => members.map((m) => m.pubkey), [members]);
  const memberProfiles = useProfiles(memberPubkeys);

  const isReady = connectionState === "ready";

  // Mark the channel read as new messages arrive while viewing it (debounced).
  const latestTs = messages.length > 0 ? messages[messages.length - 1].createdAt : 0;
  useEffect(() => {
    if (!channel.groupId || !latestTs) return;
    const t = setTimeout(() => markChannelRead(channel.groupId, latestTs), 800);
    return () => clearTimeout(t);
  }, [channel.groupId, latestTs]);

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
          {channel.about && (
            <>
              <div className="h-3.5 w-px bg-black/15 dark:bg-white/15" />
              <p className="min-w-0 truncate text-xs text-black/50 dark:text-white/50">
                {channel.about}
              </p>
            </>
          )}
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
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            title="Channel settings"
            aria-label="Channel settings"
            className="flex items-center rounded-md px-1.5 py-1 text-xs text-black/40 transition-colors hover:bg-black/5 hover:text-black/70 dark:text-white/40 dark:hover:bg-white/5 dark:hover:text-white/70"
          >
            <Settings className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Message timeline */}
        <MessageList
          messages={messages}
          myPubkey={identity?.pubkey}
          isLoading={isLoading}
          canFetchOlder={canFetchOlder}
          onFetchOlder={fetchOlder}
          reactions={reactions}
          onAddReaction={(msgId, emoji, url) => addReaction(msgId, emoji, url)}
          customEmoji={customEmoji}
          customEmojiUrls={customEmojiUrls}
          onReply={(msg) => setReplyTo(msg)}
          onEdit={(msg) => { setEditing(msg); setReplyTo(null); }}
          onDelete={(msg) => void deleteMessage(msg.id)}
          onOpenThread={(msg) => setThreadRoot(msg)}
          memberProfiles={memberProfiles}
        />

        {/* Typing indicator */}
        {typingPubkeys.length > 0 && (
          <div className="shrink-0 px-4 pb-1 text-[11px] italic text-black/40 dark:text-white/40">
            {typingPubkeys
              .slice(0, 3)
              .map((pk) => memberProfiles.get(pk)?.name ?? `${pk.slice(0, 4)}…${pk.slice(-4)}`)
              .join(", ")}
            {typingPubkeys.length === 1 ? " is typing…" : " are typing…"}
          </div>
        )}

        {/* Composer */}
        <MessageComposer
          channelName={channel.name}
          onSend={(content, mentionPubkeys, replyToId) =>
            send(content, replyToId, mentionPubkeys)
          }
          isSending={isSending}
          disabled={!isReady || !identity}
          members={members}
          profiles={memberProfiles}
          replyTo={replyTo}
          onClearReply={() => setReplyTo(null)}
          editing={editing}
          onClearEdit={() => setEditing(null)}
          onEditSave={editMessage}
          onTyping={notifyTyping}
        />
      </div>

      {/* Thread drawer */}
      {threadRoot && (
        <ThreadPanel
          root={threadRoot}
          messages={messages}
          myPubkey={identity?.pubkey}
          profiles={memberProfiles}
          members={members}
          reactions={reactions}
          onAddReaction={(msgId, emoji, url) => addReaction(msgId, emoji, url)}
          onEdit={(msg) => { setEditing(msg); setReplyTo(null); }}
          onDelete={(msg) => void deleteMessage(msg.id)}
          customEmoji={customEmoji}
          customEmojiUrls={customEmojiUrls}
          onSend={(content, replyToId, mentions) => send(content, replyToId, mentions)}
          onClose={() => setThreadRoot(null)}
        />
      )}

      {/* Members panel */}
      {membersPanelOpen && (
        <ChannelMembersPanel
          groupId={channel.groupId}
          channelName={channel.name}
          myPubkey={identity?.pubkey}
          onClose={() => setMembersPanelOpen(false)}
        />
      )}

      {/* Channel settings dialog */}
      {settingsOpen && (
        <ChannelSettingsDialog channel={channel} onClose={() => setSettingsOpen(false)} />
      )}
    </div>
  );
}
