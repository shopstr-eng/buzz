import { useEffect, useMemo, useState } from "react";
import { Bot, Hash, Lock, Search, Settings, Users, X, Zap, MessageSquare } from "lucide-react";
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
import { RemindMeDialog } from "../../reminders/ui/RemindMeDialog";
import { useAddReminder } from "../../reminders/use-reminders";
import { ReportDialog, TimeoutDialog } from "../../moderation/ui/ModerationDialogs";
import { useModeration } from "../../moderation/use-moderation";
import { ForumView } from "../../forum/ui/ForumView";
import { useAgentWorking } from "../../agents/use-agent-frames";
import { useAgentSnapshotImport } from "../../agents/use-agent-snapshot-import";
import { useTeamSnapshotImport } from "../../agents/use-team-snapshot-import";
import { CanvasView } from "../../canvas/ui/CanvasView";
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
  const { send, isSending, timeoutRejection } = useSendMessage(
    channel.groupId,
    addOptimistic,
    applyLocalDelete,
  );
  const { editMessage, deleteMessage } = useMessageActions(
    channel.groupId,
    applyLocalEdit,
    applyLocalDelete,
  );
  const { members } = useChannelMembers(channel.groupId);
  const { submitReport, timeoutMember, banMember, unbanMember, untimeoutMember } = useModeration();
  const [reportTarget, setReportTarget] = useState<ChatMessage | null>(null);
  const [timeoutTarget, setTimeoutTarget] = useState<ChatMessage | null>(null);
  const myRole = members.find((m) => m.pubkey === identity?.pubkey)?.role;
  const canModerate = myRole === "owner" || myRole === "admin";
  const { reactions, addReaction } = useReactions(channel.groupId, identity?.pubkey);
  const { customEmoji, customEmojiUrls } = useCustomEmoji();
  const { importSnapshot } = useAgentSnapshotImport();
  const { importTeamSnapshot } = useTeamSnapshotImport();
  const [membersPanelOpen, setMembersPanelOpen] = useState(false);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const [threadRoot, setThreadRoot] = useState<ChatMessage | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [remindTarget, setRemindTarget] = useState<ChatMessage | null>(null);
  const addReminder = useAddReminder();
  const isForum = channel.channelType === "forum";
  const hasCanvas = channel.channelType !== "dm";
  type ChannelTab = "chat" | "forum" | "canvas";
  const tabs: ChannelTab[] = ["chat", ...(isForum ? ["forum" as const] : []), ...(hasCanvas ? ["canvas" as const] : [])];
  const [activeTab, setActiveTab] = useState<ChannelTab>("chat");

  // In-channel find bar: filters the loaded timeline client-side.
  const visibleMessages = useMemo(() => {
    const q = findQuery.trim().toLowerCase();
    if (!findOpen || !q) return messages;
    return messages.filter((m) => m.content.toLowerCase().includes(q));
  }, [messages, findOpen, findQuery]);
  const typingPubkeys = useTypingIndicator(channel.groupId);
  const agentWorking = useAgentWorking(channel.groupId);
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
            onClick={() => { setFindOpen((o) => !o); setFindQuery(""); }}
            title="Find in channel"
            aria-label="Find in channel"
            aria-pressed={findOpen}
            className={`flex items-center rounded-md px-1.5 py-1 text-xs transition-colors ${
              findOpen
                ? "bg-black/10 text-black dark:bg-white/15 dark:text-white"
                : "text-black/40 hover:bg-black/5 hover:text-black/70 dark:text-white/40 dark:hover:bg-white/5 dark:hover:text-white/70"
            }`}
          >
            <Search className="h-3.5 w-3.5" />
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

        {/* In-channel find bar */}
        {findOpen && (
          <div className="flex shrink-0 items-center gap-2 border-b border-black/10 px-4 py-2 dark:border-white/10">
            <Search className="h-3.5 w-3.5 shrink-0 text-black/30 dark:text-white/30" />
            <input
              type="search"
              value={findQuery}
              onChange={(e) => setFindQuery(e.target.value)}
              placeholder="Find in this channel…"
              autoFocus
              className="flex-1 bg-transparent text-xs text-black placeholder:text-black/35 focus:outline-none dark:text-white dark:placeholder:text-white/35"
            />
            {findQuery.trim() && (
              <span className="text-[10px] text-black/40 dark:text-white/40">
                {visibleMessages.length} match{visibleMessages.length === 1 ? "" : "es"}
              </span>
            )}
            <button
              type="button"
              onClick={() => { setFindOpen(false); setFindQuery(""); }}
              aria-label="Close find"
              className="text-black/30 hover:text-black/60 dark:text-white/30 dark:hover:text-white/60"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Chat / Forum / Canvas tabs */}
        {(isForum || hasCanvas) && (
          <div className="flex shrink-0 gap-1 border-b border-black/10 px-4 py-1.5 dark:border-white/10">
            {tabs.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setActiveTab(t)}
                className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                  activeTab === t
                    ? "bg-black/10 text-black dark:bg-white/15 dark:text-white"
                    : "text-black/50 hover:text-black dark:text-white/50 dark:hover:text-white"
                }`}
              >
                {t === "chat" ? "Chat" : t === "forum" ? "Forum" : "Canvas"}
              </button>
            ))}
          </div>
        )}

        {activeTab === "canvas" && hasCanvas ? (
          <CanvasView channel={channel} />
        ) : !isForum || activeTab === "chat" ? (
          <>
        {/* Message timeline */}
        <MessageList
          messages={visibleMessages}
          myPubkey={identity?.pubkey}
          isLoading={isLoading}
          canFetchOlder={canFetchOlder}
          onFetchOlder={fetchOlder}
          resetKey={channel.groupId}
          reactions={reactions}
          onAddReaction={(msgId, emoji, url) => addReaction(msgId, emoji, url)}
          customEmoji={customEmoji}
          customEmojiUrls={customEmojiUrls}
          onReply={(msg) => setReplyTo(msg)}
          onEdit={(msg) => { setEditing(msg); setReplyTo(null); }}
          onDelete={(msg) => void deleteMessage(msg.id)}
          onImportAgent={async (jsonText) => { await importSnapshot(jsonText); }}
          onImportTeam={async (jsonText) => { await importTeamSnapshot(jsonText); }}
          onOpenThread={(msg) => setThreadRoot(msg)}
          onRemind={(msg) => setRemindTarget(msg)}
          canModerate={canModerate}
          onReport={(msg) => setReportTarget(msg)}
          onTimeout={(msg) => setTimeoutTarget(msg)}
          onBan={(msg) => {
            const name = memberProfiles.get(msg.pubkey)?.name ?? `${msg.pubkey.slice(0, 4)}…${msg.pubkey.slice(-4)}`;
            if (window.confirm(`Ban ${name} from the community?`)) {
              void banMember(msg.pubkey).catch(() => {});
            }
          }}
          onUnban={(msg) => {
            const name = memberProfiles.get(msg.pubkey)?.name ?? `${msg.pubkey.slice(0, 4)}…${msg.pubkey.slice(-4)}`;
            if (window.confirm(`Lift the community ban for ${name}?`)) {
              void unbanMember(msg.pubkey).catch(() => {});
            }
          }}
          onUntimeout={(msg) => {
            const name = memberProfiles.get(msg.pubkey)?.name ?? `${msg.pubkey.slice(0, 4)}…${msg.pubkey.slice(-4)}`;
            if (window.confirm(`Lift the active timeout for ${name}?`)) {
              void untimeoutMember(msg.pubkey).catch(() => {});
            }
          }}
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

        {/* Agent working indicator (live observer frames, 24200) */}
        {agentWorking.length > 0 && (
          <div className="flex shrink-0 items-center gap-1.5 px-4 pb-1 text-[11px] italic text-violet-600 dark:text-violet-300">
            <Bot className="h-3 w-3 shrink-0 animate-pulse" />
            {agentWorking.length === 1 ? (
              <>
                Agent is working
                {agentWorking[0].text && agentWorking[0].text !== "Turn started"
                  ? ` — ${agentWorking[0].text.slice(0, 60)}`
                  : "…"}
              </>
            ) : (
              `${agentWorking.length} agents are working…`
            )}
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
          timeoutRejection={timeoutRejection}
        />
          </>
        ) : (
          <ForumView channel={channel} />
        )}
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
          onImportAgent={async (jsonText) => { await importSnapshot(jsonText); }}
          onImportTeam={async (jsonText) => { await importTeamSnapshot(jsonText); }}
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

      {/* Remind me dialog */}
      {remindTarget && (
        <RemindMeDialog
          message={remindTarget}
          groupId={channel.groupId}
          onSave={addReminder}
          onClose={() => setRemindTarget(null)}
        />
      )}

      {/* Report dialog */}
      {reportTarget && (
        <ReportDialog
          message={reportTarget}
          onSubmit={(reportType, note) =>
            submitReport(reportTarget.pubkey, reportTarget.id, reportType, note)
          }
          onClose={() => setReportTarget(null)}
        />
      )}

      {/* Timeout dialog */}
      {timeoutTarget && (
        <TimeoutDialog
          memberName={
            memberProfiles.get(timeoutTarget.pubkey)?.name ??
            `${timeoutTarget.pubkey.slice(0, 4)}…${timeoutTarget.pubkey.slice(-4)}`
          }
          onSubmit={(seconds, reason) => timeoutMember(timeoutTarget.pubkey, seconds, reason)}
          onClose={() => setTimeoutTarget(null)}
        />
      )}
    </div>
  );
}
