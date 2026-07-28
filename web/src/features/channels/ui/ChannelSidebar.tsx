import { useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { avatarColor } from "@/shared/lib/avatar-color";
import {
  AlarmClock, BookMarked, Bot, Hash, Home, Lock, MessageCircle, Settings, Wifi, WifiOff, Loader, LogOut,
  Zap, MessageSquare, Plus, Pencil, Pin, PinOff, Search,
} from "lucide-react";
import { useRelay } from "@/shared/context/relay-context";
import { useChannels } from "../use-channels";
import { useReadState, type ChannelUnread } from "../use-read-state";
import { usePinnedChannels } from "../use-pinned-channels";
import { usePresenceLifecycle } from "../use-presence";
import { useUserStatusLifecycle, useUserStatusMap } from "../use-user-status";
import { SetStatusDialog } from "./SetStatusDialog";
import { useCustomEmoji } from "../use-custom-emoji";
import { useNotificationAlerts } from "../../notifications/use-notification-alerts";
import { NewDmDialog } from "../../dms/ui/NewDmDialog";
import type { Channel, ChannelType } from "../types";
import { CreateChannelDialog } from "./CreateChannelDialog";
import { ProfileEditDialog } from "./ProfileEditDialog";
import { useProfiles } from "@/shared/hooks/use-profiles";
import buzzAppIcon from "@/assets/app-icon@3x.png";

const EMPTY_PUBKEYS: string[] = [];

function ConnectionBadge() {
  const { connectionState } = useRelay();
  if (connectionState === "ready")
    return (
      <span className="flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400">
        <Wifi className="h-3 w-3" /> Connected
      </span>
    );
  if (connectionState === "disconnected")
    return (
      <span className="flex items-center gap-1 text-[11px] text-black/40 dark:text-white/40">
        <WifiOff className="h-3 w-3" /> Offline
      </span>
    );
  return (
    <span className="flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400">
      <Loader className="h-3 w-3 animate-spin" /> Connecting…
    </span>
  );
}

function TypeIcon({ type, isPrivate }: { type: ChannelType; isPrivate: boolean }) {
  if (type === "dm") return <MessageCircle className="h-3.5 w-3.5 shrink-0 opacity-60" />;
  if (isPrivate) return <Lock className="h-3.5 w-3.5 shrink-0 opacity-60" />;
  if (type === "workflow") return <Zap className="h-3.5 w-3.5 shrink-0 text-violet-500 opacity-70 dark:text-violet-400" />;
  if (type === "forum") return <MessageSquare className="h-3.5 w-3.5 shrink-0 opacity-60" />;
  return <Hash className="h-3.5 w-3.5 shrink-0 opacity-60" />;
}

/** DM sidebar item: label = other participants' names. */
function DmItem({
  channel,
  unread,
  myPubkey,
  profiles,
}: {
  channel: Channel;
  unread?: ChannelUnread;
  myPubkey?: string;
  profiles: Map<string, import("@/shared/hooks/use-profiles").Profile>;
}) {
  const { location } = useRouterState();
  const isActive = location.pathname === `/channels/${channel.groupId}`;
  const hasUnread = !isActive && unread && unread.count > 0;

  const others = (channel.participantPubkeys ?? []).filter((pk) => pk !== myPubkey);
  const label =
    others.length === 0
      ? "Just you"
      : others
          .map((pk) => profiles.get(pk)?.name ?? `${pk.slice(0, 4)}…${pk.slice(-4)}`)
          .join(", ");

  return (
    <Link
      to="/channels/$groupId"
      params={{ groupId: channel.groupId }}
      className={`flex items-center gap-2 rounded-md px-2 py-1 text-sm transition-colors ${
        isActive
          ? "bg-black/10 font-medium text-black dark:bg-white/15 dark:text-white"
          : hasUnread
            ? "font-semibold text-black hover:bg-black/5 dark:text-white dark:hover:bg-white/5"
            : "text-black/60 hover:bg-black/5 hover:text-black dark:text-white/50 dark:hover:bg-white/5 dark:hover:text-white"
      }`}
    >
      <TypeIcon type="dm" isPrivate={false} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {hasUnread && (
        <span className="ml-auto flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-violet-600 px-1 text-[10px] font-bold text-white">
          {unread.count > 99 ? "99+" : unread.count}
        </span>
      )}
    </Link>
  );
}

function ChannelItem({
  channel,
  unread,
  isPinned,
  onTogglePin,
}: {
  channel: Channel;
  unread?: ChannelUnread;
  isPinned?: boolean;
  onTogglePin?: () => void;
}) {
  const { location } = useRouterState();
  const isActive = location.pathname === `/channels/${channel.groupId}`;
  const hasUnread = !isActive && unread && unread.count > 0;

  return (
    <div className="group relative">
      <Link
        to="/channels/$groupId"
        params={{ groupId: channel.groupId }}
        className={`flex items-center gap-2 rounded-md px-2 py-1 text-sm transition-colors ${
          isActive
            ? "bg-black/10 font-medium text-black dark:bg-white/15 dark:text-white"
            : hasUnread
              ? "font-semibold text-black hover:bg-black/5 dark:text-white dark:hover:bg-white/5"
              : "text-black/60 hover:bg-black/5 hover:text-black dark:text-white/50 dark:hover:bg-white/5 dark:hover:text-white"
        }`}
      >
        <TypeIcon type={channel.channelType} isPrivate={channel.isPrivate} />
        <span className="min-w-0 flex-1 truncate">{channel.name}</span>
        {hasUnread && unread.mention && (
          <span className="ml-auto flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-violet-600 px-1 text-[10px] font-bold text-white">
            {unread.count > 99 ? "99+" : unread.count}
          </span>
        )}
        {hasUnread && !unread.mention && (
          <span className="ml-auto h-2 w-2 shrink-0 rounded-full bg-black/40 dark:bg-white/50" />
        )}
      </Link>
      {onTogglePin && (
        <button
          type="button"
          onClick={onTogglePin}
          title={isPinned ? "Unpin channel" : "Pin channel"}
          aria-label={isPinned ? "Unpin channel" : "Pin channel"}
          className={`absolute right-1 top-1/2 -translate-y-1/2 rounded p-0.5 transition-opacity ${
            isPinned
              ? "text-black/40 opacity-100 dark:text-white/40"
              : "text-black/30 opacity-0 group-hover:opacity-100 dark:text-white/30"
          } hover:bg-black/10 dark:hover:bg-white/10 ${hasUnread ? "hidden group-hover:block" : ""}`}
        >
          {isPinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
        </button>
      )}
    </div>
  );
}

/** Search box: Enter jumps to the global search page. */
function SidebarSearch() {
  const navigate = useNavigate();
  const [value, setValue] = useState("");
  const { location } = useRouterState();
  const searchActive = location.pathname === "/channels/search";

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    void navigate({ to: "/channels/search", search: { q: value.trim() } });
  }

  return (
    <form onSubmit={handleSubmit} className="mb-2">
      <div
        className={`flex items-center gap-1.5 rounded-md border px-2 py-1 ${
          searchActive
            ? "border-black/25 dark:border-white/25"
            : "border-black/10 dark:border-white/10"
        }`}
      >
        <Search className="h-3 w-3 shrink-0 text-black/30 dark:text-white/30" />
        <input
          type="search"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Search…"
          aria-label="Search messages"
          className="w-full bg-transparent text-xs text-black placeholder:text-black/35 focus:outline-none dark:text-white dark:placeholder:text-white/35"
        />
      </div>
    </form>
  );
}

export function ChannelSidebar() {
  const { channels, isLoading } = useChannels();
  const { unread } = useReadState();
  const { pinned, togglePin } = usePinnedChannels();
  const { identity, logout } = useRelay();
  const { location } = useRouterState();
  const reposActive = location.pathname.startsWith("/repos");
  const [showCreate, setShowCreate] = useState(false);
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [showSetStatus, setShowSetStatus] = useState(false);
  const [showNewDm, setShowNewDm] = useState(false);

  // Global presence + user-status lifecycles (mounted once here).
  usePresenceLifecycle();
  // Mention alerts (browser notifications + sound), mounted once.
  useNotificationAlerts();
  const { publishStatus } = useUserStatusLifecycle();
  const userStatuses = useUserStatusMap();
  const { customEmoji } = useCustomEmoji();
  const myStatus = identity ? userStatuses.get(identity.pubkey) : undefined;

  // Fetch own profile for display name in the footer.
  const selfPubkeys = identity ? [identity.pubkey] : EMPTY_PUBKEYS;
  const profiles = useProfiles(selfPubkeys);
  const myProfile = identity ? profiles.get(identity.pubkey) : undefined;

  const shortPubkey = identity
    ? `${identity.pubkey.slice(0, 8)}…${identity.pubkey.slice(-4)}`
    : null;
  const displayName = myProfile?.name ?? shortPubkey;

  const dmChannels = channels.filter((ch) => ch.channelType === "dm");
  const regularChannels = channels.filter((ch) => ch.channelType !== "dm");
  const pinnedChannels = regularChannels.filter((ch) => pinned.has(ch.groupId));
  const unpinnedChannels = regularChannels.filter((ch) => !pinned.has(ch.groupId));

  // Profiles for DM participant labels.
  const dmParticipantPubkeys = dmChannels.flatMap((ch) =>
    (ch.participantPubkeys ?? []).filter((pk) => pk !== identity?.pubkey),
  );
  const dmProfiles = useProfiles(dmParticipantPubkeys);

  return (
    <>
      <aside className="flex h-full w-56 shrink-0 flex-col border-r border-black/10 bg-[#EBEBEB] dark:border-white/10 dark:bg-[#1A1A1A]">
        {/* Workspace header */}
        <div className="flex items-center gap-2.5 border-b border-black/10 px-3 py-3 dark:border-white/10">
          <div
            className="h-6 w-6 shrink-0 overflow-hidden bg-black"
            style={{ borderRadius: "22.37%" }}
          >
            <img alt="Buzz" className="h-full w-full" src={buzzAppIcon} />
          </div>
          <span className="min-w-0 truncate text-sm font-semibold text-black dark:text-white">
            Buzz
          </span>
        </div>

        {/* Nav */}
        <div className="flex-1 overflow-y-auto px-2 py-3">
          {/* Global search */}
          <SidebarSearch />

          {/* Home link */}
          <Link
            to="/channels/home"
            className={`mb-2 flex items-center gap-2 rounded-md px-2 py-1 text-sm transition-colors ${
              location.pathname === "/channels/home"
                ? "bg-black/10 font-medium text-black dark:bg-white/15 dark:text-white"
                : "text-black/60 hover:bg-black/5 hover:text-black dark:text-white/50 dark:hover:bg-white/5 dark:hover:text-white"
            }`}
          >
            <Home className="h-3.5 w-3.5 shrink-0 opacity-60" />
            Home
          </Link>

          {/* Reminders link */}
          <Link
            to="/channels/reminders"
            className={`mb-2 flex items-center gap-2 rounded-md px-2 py-1 text-sm transition-colors ${
              location.pathname === "/channels/reminders"
                ? "bg-black/10 font-medium text-black dark:bg-white/15 dark:text-white"
                : "text-black/60 hover:bg-black/5 hover:text-black dark:text-white/50 dark:hover:bg-white/5 dark:hover:text-white"
            }`}
          >
            <AlarmClock className="h-3.5 w-3.5 shrink-0 opacity-60" />
            Reminders
          </Link>

          {/* Agents link */}
          <Link
            to="/channels/agents"
            className={`mb-2 flex items-center gap-2 rounded-md px-2 py-1 text-sm transition-colors ${
              location.pathname === "/channels/agents"
                ? "bg-black/10 font-medium text-black dark:bg-white/15 dark:text-white"
                : "text-black/60 hover:bg-black/5 hover:text-black dark:text-white/50 dark:hover:bg-white/5 dark:hover:text-white"
            }`}
          >
            <Bot className="h-3.5 w-3.5 shrink-0 opacity-60" />
            Agents
          </Link>

          {/* Repos link */}
          <Link
            to="/repos"
            className={`mb-2 flex items-center gap-2 rounded-md px-2 py-1 text-sm transition-colors ${
              reposActive
                ? "bg-black/10 font-medium text-black dark:bg-white/15 dark:text-white"
                : "text-black/60 hover:bg-black/5 hover:text-black dark:text-white/50 dark:hover:bg-white/5 dark:hover:text-white"
            }`}
          >
            <BookMarked className="h-3.5 w-3.5 shrink-0 opacity-60" />
            Repositories
          </Link>

          {/* Channels section header */}
          <div className="mb-1 flex items-center justify-between px-2">
            <span className="text-[11px] font-semibold uppercase tracking-widest text-black/40 dark:text-white/40">
              Channels
            </span>
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              title="New channel"
              aria-label="New channel"
              className="rounded p-0.5 text-black/30 transition-colors hover:bg-black/10 hover:text-black/70 dark:text-white/30 dark:hover:bg-white/10 dark:hover:text-white/70"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>

          {isLoading ? (
            <div className="space-y-1 px-2 pt-1">
              {[40, 56, 48, 36, 52].map((w) => (
                <div
                  key={w}
                  className="h-6 animate-pulse rounded bg-black/10 dark:bg-white/10"
                  style={{ width: `${w}%` }}
                />
              ))}
            </div>
          ) : channels.length === 0 ? (
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              className="w-full px-2 pt-1 text-left text-xs text-black/40 underline-offset-2 hover:text-black/60 hover:underline dark:text-white/40 dark:hover:text-white/60"
            >
              + Create first channel
            </button>
          ) : (
            <div className="space-y-0.5">
              {pinnedChannels.length > 0 && (
                <>
                  <div className="px-2 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-widest text-black/30 dark:text-white/30">
                    Pinned
                  </div>
                  {pinnedChannels.map((ch) => (
                    <ChannelItem
                      key={ch.groupId}
                      channel={ch}
                      unread={unread.get(ch.groupId)}
                      isPinned
                      onTogglePin={() => togglePin(ch.groupId)}
                    />
                  ))}
                  <div className="px-2 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-widest text-black/30 dark:text-white/30">
                    Channels
                  </div>
                </>
              )}
              {unpinnedChannels.map((ch) => (
                <ChannelItem
                  key={ch.groupId}
                  channel={ch}
                  unread={unread.get(ch.groupId)}
                  onTogglePin={() => togglePin(ch.groupId)}
                />
              ))}

              {/* Direct messages section */}
              <div className="mb-1 mt-3 flex items-center justify-between px-2">
                <span className="text-[11px] font-semibold uppercase tracking-widest text-black/40 dark:text-white/40">
                  Direct messages
                </span>
                <button
                  type="button"
                  onClick={() => setShowNewDm(true)}
                  title="New message"
                  aria-label="New message"
                  className="rounded p-0.5 text-black/30 transition-colors hover:bg-black/10 hover:text-black/70 dark:text-white/30 dark:hover:bg-white/10 dark:hover:text-white/70"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
              {dmChannels.map((ch) => (
                <DmItem
                  key={ch.groupId}
                  channel={ch}
                  unread={unread.get(ch.groupId)}
                  myPubkey={identity?.pubkey}
                  profiles={dmProfiles}
                />
              ))}
            </div>
          )}
        </div>

        {/* Footer — identity + connection status */}
        <div className="shrink-0 border-t border-black/10 px-3 py-2.5 dark:border-white/10">
          <ConnectionBadge />
          {identity && (
            <div className="mt-1.5 flex items-center justify-between gap-1.5">
              {/* Own avatar: profile picture with colored-initial fallback. */}
              <FooterAvatar pubkey={identity.pubkey} name={myProfile?.name} picture={myProfile?.picture} />
              {/* Name / pubkey + status */}
              <button
                type="button"
                onClick={() => setShowSetStatus(true)}
                title="Set a status"
                className="min-w-0 flex-1 text-left"
              >
                <span className="block truncate text-[11px] text-black/50 dark:text-white/40" title={identity.pubkey}>
                  {displayName}
                </span>
                {myStatus && (myStatus.text || myStatus.emoji) ? (
                  <span className="block truncate text-[10px] text-black/40 dark:text-white/30">
                    {myStatus.emoji} {myStatus.text}
                  </span>
                ) : (
                  <span className="block truncate text-[10px] text-black/25 hover:text-black/40 dark:text-white/25 dark:hover:text-white/40">
                    + Set status
                  </span>
                )}
              </button>

              {/* Settings + edit profile + logout */}
              <div className="flex shrink-0 items-center gap-0.5">
                <Link
                  to="/channels/settings"
                  title="Settings"
                  aria-label="Settings"
                  className="rounded p-1 text-black/30 transition-colors hover:bg-black/10 hover:text-black/70 dark:text-white/30 dark:hover:bg-white/10 dark:hover:text-white/70"
                >
                  <Settings className="h-3 w-3" />
                </Link>
                <button
                  type="button"
                  onClick={() => setShowEditProfile(true)}
                  title="Edit profile"
                  aria-label="Edit profile"
                  className="rounded p-1 text-black/30 transition-colors hover:bg-black/10 hover:text-black/70 dark:text-white/30 dark:hover:bg-white/10 dark:hover:text-white/70"
                >
                  <Pencil className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={logout}
                  title="Sign out"
                  aria-label="Sign out"
                  className="rounded p-1 text-black/30 transition-colors hover:bg-black/10 hover:text-black/70 dark:text-white/30 dark:hover:bg-white/10 dark:hover:text-white/70"
                >
                  <LogOut className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      </aside>

      {showCreate && (
        <CreateChannelDialog onClose={() => setShowCreate(false)} />
      )}
      {showEditProfile && (
        <ProfileEditDialog onClose={() => setShowEditProfile(false)} />
      )}
      {showSetStatus && (
        <SetStatusDialog
          currentText={myStatus?.text}
          currentEmoji={myStatus?.emoji}
          customEmoji={customEmoji}
          onSave={publishStatus}
          onClose={() => setShowSetStatus(false)}
        />
      )}
      {showNewDm && <NewDmDialog onClose={() => setShowNewDm(false)} />}
    </>
  );
}

/** Own-identity avatar for the sidebar footer: profile picture with a
 *  declarative colored-initial fallback (resets when the picture URL changes
 *  so a previously-failed image can recover). */
function FooterAvatar({
  pubkey,
  name,
  picture,
}: {
  pubkey: string;
  name?: string | null;
  picture?: string | null;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const [lastPicture, setLastPicture] = useState(picture);
  if (picture !== lastPicture) {
    setLastPicture(picture);
    setImgFailed(false);
  }
  return (
    <div
      className="relative flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full text-[10px] font-semibold text-white"
      style={{ backgroundColor: avatarColor(pubkey) }}
    >
      {(name?.[0] ?? pubkey[0]).toUpperCase()}
      {picture && !imgFailed && (
        <img
          src={picture}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          onError={() => setImgFailed(true)}
        />
      )}
    </div>
  );
}
