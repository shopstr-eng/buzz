import { useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { BookMarked, Hash, Lock, Wifi, WifiOff, Loader, LogOut, Zap, MessageSquare, Plus } from "lucide-react";
import { useRelay } from "@/shared/context/relay-context";
import { useChannels } from "../use-channels";
import type { Channel, ChannelType } from "../types";
import { CreateChannelDialog } from "./CreateChannelDialog";
import buzzAppIcon from "@/assets/app-icon@3x.png";

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
  if (isPrivate) return <Lock className="h-3.5 w-3.5 shrink-0 opacity-60" />;
  if (type === "workflow") return <Zap className="h-3.5 w-3.5 shrink-0 text-violet-500 opacity-70 dark:text-violet-400" />;
  if (type === "forum") return <MessageSquare className="h-3.5 w-3.5 shrink-0 opacity-60" />;
  return <Hash className="h-3.5 w-3.5 shrink-0 opacity-60" />;
}

function ChannelItem({ channel }: { channel: Channel }) {
  const { location } = useRouterState();
  const isActive = location.pathname === `/channels/${channel.groupId}`;

  return (
    <Link
      to="/channels/$groupId"
      params={{ groupId: channel.groupId }}
      className={`flex items-center gap-2 rounded-md px-2 py-1 text-sm transition-colors ${
        isActive
          ? "bg-black/10 font-medium text-black dark:bg-white/15 dark:text-white"
          : "text-black/60 hover:bg-black/5 hover:text-black dark:text-white/50 dark:hover:bg-white/5 dark:hover:text-white"
      }`}
    >
      <TypeIcon type={channel.channelType} isPrivate={channel.isPrivate} />
      <span className="min-w-0 flex-1 truncate">{channel.name}</span>
    </Link>
  );
}

export function ChannelSidebar() {
  const { channels, isLoading } = useChannels();
  const { identity, logout } = useRelay();
  const { location } = useRouterState();
  const reposActive = location.pathname.startsWith("/repos");
  const [showCreate, setShowCreate] = useState(false);

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
              {channels.map((ch) => (
                <ChannelItem key={ch.groupId} channel={ch} />
              ))}
            </div>
          )}
        </div>

        {/* Footer — identity + connection status */}
        <div className="shrink-0 border-t border-black/10 px-3 py-2.5 dark:border-white/10">
          <ConnectionBadge />
          {identity && (
            <div className="mt-1.5 flex items-center justify-between gap-2">
              <span
                className="min-w-0 truncate text-[11px] text-black/40 dark:text-white/40"
                title={identity.pubkey}
              >
                {identity.pubkey.slice(0, 8)}…{identity.pubkey.slice(-4)}
              </span>
              <button
                type="button"
                onClick={logout}
                title="Sign out"
                className="shrink-0 text-black/30 transition-colors hover:text-black/70 dark:text-white/30 dark:hover:text-white/70"
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
      </aside>

      {showCreate && (
        <CreateChannelDialog onClose={() => setShowCreate(false)} />
      )}
    </>
  );
}
