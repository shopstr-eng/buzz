/**
 * Right-side slide panel showing who is in the current channel.
 * Members come from kind:39002; agents are identified by kind:10100.
 *
 * Owners and admins see inline action buttons for kicking and role changes.
 * The relay enforces server-side authorisation; we just shape the UI to what
 * the signed-in user is likely allowed to do.
 */

import { useState, useRef, useEffect, useCallback } from "react";
import {
  X, Bot, Crown, ShieldCheck, UserRound, Zap,
  MoreHorizontal, ShieldPlus, ShieldMinus, UserMinus,
  Loader2,
} from "lucide-react";
import { useChannelMembers, type ChannelMember } from "../use-channel-members";
import { ConnectAgentDialog } from "./ConnectAgentDialog";

// Deterministic avatar colour from pubkey.
const AVATAR_PALETTE = [
  "#6366f1", "#8b5cf6", "#a855f7", "#ec4899",
  "#14b8a6", "#22c55e", "#f59e0b", "#3b82f6",
  "#f97316", "#ef4444", "#0ea5e9", "#84cc16",
];

function avatarColor(pubkey: string): string {
  const n = parseInt(pubkey.slice(0, 8), 16);
  return AVATAR_PALETTE[n % AVATAR_PALETTE.length];
}

function RoleBadge({ role }: { role: ChannelMember["role"] }) {
  if (role === "owner")
    return <Crown className="h-3 w-3 shrink-0 text-amber-500" aria-label="Owner" />;
  if (role === "admin")
    return <ShieldCheck className="h-3 w-3 shrink-0 text-blue-500" aria-label="Admin" />;
  return null;
}

// ── Action menu ──────────────────────────────────────────────────────────────

interface ActionMenuProps {
  member: ChannelMember;
  myRole: "owner" | "admin" | "member";
  onKick: () => void;
  onChangeRole: (role: "admin" | "member") => void;
  onClose: () => void;
}

function ActionMenu({ member, myRole, onKick, onChangeRole, onClose }: ActionMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click.
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const canChangeRole = myRole === "owner" && member.role !== "owner";
  const canKick =
    myRole === "owner"
      ? member.role !== "owner"
      : myRole === "admin" && member.role === "member";

  return (
    <div
      ref={ref}
      className="absolute right-0 top-full z-20 mt-0.5 w-44 overflow-hidden rounded-lg border border-black/10 bg-white shadow-lg dark:border-white/10 dark:bg-[#242424]"
    >
      {canChangeRole && member.role === "member" && (
        <button
          type="button"
          onClick={() => { onChangeRole("admin"); onClose(); }}
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-black/70 hover:bg-black/5 dark:text-white/70 dark:hover:bg-white/5"
        >
          <ShieldPlus className="h-3.5 w-3.5 text-blue-500" />
          Make admin
        </button>
      )}
      {canChangeRole && member.role === "admin" && (
        <button
          type="button"
          onClick={() => { onChangeRole("member"); onClose(); }}
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-black/70 hover:bg-black/5 dark:text-white/70 dark:hover:bg-white/5"
        >
          <ShieldMinus className="h-3.5 w-3.5 text-black/40 dark:text-white/40" />
          Remove admin
        </button>
      )}
      {canKick && (
        <button
          type="button"
          onClick={() => { onKick(); onClose(); }}
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"
        >
          <UserMinus className="h-3.5 w-3.5" />
          Remove from channel
        </button>
      )}
    </div>
  );
}

// ── Member row ───────────────────────────────────────────────────────────────

interface MemberRowProps {
  member: ChannelMember;
  /** The signed-in user's role in this channel — null if not a member. */
  myRole: "owner" | "admin" | "member" | null;
  isSelf: boolean;
  onKick: (pubkey: string) => Promise<void>;
  onChangeRole: (pubkey: string, role: "admin" | "member") => Promise<void>;
}

function MemberRow({ member, myRole, isSelf, onKick, onChangeRole }: MemberRowProps) {
  const short = `${member.pubkey.slice(0, 7)}…${member.pubkey.slice(-4)}`;
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canAct =
    !isSelf &&
    myRole != null &&
    myRole !== "member" &&
    member.role !== "owner" &&
    !(myRole === "admin" && member.role === "admin");

  const handleKick = useCallback(async () => {
    setActing(true);
    setError(null);
    try {
      await onKick(member.pubkey);
      // List will refresh via 44100/44101 notification; no local state change needed.
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed.");
      setConfirming(false);
    } finally {
      setActing(false);
    }
  }, [onKick, member.pubkey]);

  const handleChangeRole = useCallback(async (role: "admin" | "member") => {
    setActing(true);
    setError(null);
    try {
      await onChangeRole(member.pubkey, role);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed.");
    } finally {
      setActing(false);
    }
  }, [onChangeRole, member.pubkey]);

  // Inline kick confirmation state.
  if (confirming) {
    return (
      <div className="flex items-center gap-1 rounded-md px-2 py-1.5">
        <span className="min-w-0 flex-1 truncate text-xs text-red-600 dark:text-red-400">
          Remove {short}?
        </span>
        <button
          type="button"
          onClick={handleKick}
          disabled={acting}
          className="flex items-center gap-1 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700 hover:bg-red-200 disabled:opacity-50 dark:bg-red-900/40 dark:text-red-300 dark:hover:bg-red-900/60"
        >
          {acting ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : null}
          {acting ? "…" : "Remove"}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={acting}
          className="rounded px-1.5 py-0.5 text-[10px] text-black/40 hover:bg-black/5 dark:text-white/40 dark:hover:bg-white/5"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="group relative flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-black/5 dark:hover:bg-white/5">
      {/* Avatar */}
      <div
        className="relative flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
        style={{ backgroundColor: avatarColor(member.pubkey) }}
        title={member.pubkey}
      >
        {member.isAgent ? (
          <Bot className="h-3.5 w-3.5" />
        ) : (
          member.pubkey[0].toUpperCase()
        )}
      </div>

      {/* Label */}
      <span
        className="min-w-0 flex-1 truncate text-xs text-black/70 dark:text-white/70"
        title={member.pubkey}
      >
        {short}
      </span>

      {/* Badges */}
      <div className="flex shrink-0 items-center gap-1">
        {member.isAgent && (
          <span className="rounded bg-violet-100 px-1 py-0.5 text-[10px] font-medium text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
            Agent
          </span>
        )}
        <RoleBadge role={member.role} />

        {/* Action button — visible on hover when user has permissions */}
        {canAct && !acting && (
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            className="ml-0.5 rounded p-0.5 text-black/0 transition-colors hover:bg-black/10 hover:text-black/50 group-hover:text-black/30 dark:hover:bg-white/10 dark:hover:text-white/60 dark:group-hover:text-white/30"
            aria-label="Member actions"
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </button>
        )}
        {acting && <Loader2 className="h-3 w-3 animate-spin text-black/30 dark:text-white/30" />}
      </div>

      {/* Error message */}
      {error && (
        <span className="absolute bottom-0 left-0 right-0 truncate bg-red-50 px-2 py-0.5 text-[10px] text-red-600 dark:bg-red-950/30 dark:text-red-400">
          {error}
        </span>
      )}

      {/* Dropdown menu */}
      {menuOpen && myRole && myRole !== "member" && (
        <ActionMenu
          member={member}
          myRole={myRole}
          onKick={() => { setMenuOpen(false); setConfirming(true); }}
          onChangeRole={handleChangeRole}
          onClose={() => setMenuOpen(false)}
        />
      )}
    </div>
  );
}

function SectionHeader({ label, count }: { label: string; count: number }) {
  return (
    <div className="mb-1 mt-3 flex items-center gap-1.5 px-2">
      <span className="text-[10px] font-semibold uppercase tracking-widest text-black/35 dark:text-white/35">
        {label}
      </span>
      <span className="text-[10px] text-black/30 dark:text-white/30">{count}</span>
    </div>
  );
}

// ── Panel ────────────────────────────────────────────────────────────────────

interface Props {
  groupId: string;
  channelName?: string;
  myPubkey?: string;
  onClose: () => void;
}

export function ChannelMembersPanel({ groupId, channelName: _channelName, myPubkey, onClose }: Props) {
  const { members, isLoading, kickMember, changeRole } = useChannelMembers(groupId);
  const [showConnectAgent, setShowConnectAgent] = useState(false);

  const myRole = myPubkey
    ? (members.find((m) => m.pubkey === myPubkey)?.role ?? null)
    : null;

  const owners = members.filter((m) => m.role === "owner");
  const admins = members.filter((m) => m.role === "admin");
  const regular = members.filter((m) => m.role === "member");

  return (
    <aside className="flex h-full w-56 shrink-0 flex-col border-l border-black/10 bg-[#F5F5F5] dark:border-white/10 dark:bg-[#1C1C1C]">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-black/10 px-3 py-3 dark:border-white/10">
        <div className="flex items-center gap-1.5">
          <UserRound className="h-3.5 w-3.5 text-black/50 dark:text-white/50" />
          <h2 className="text-xs font-semibold text-black/70 dark:text-white/70">
            Members
          </h2>
          {!isLoading && (
            <span className="text-xs text-black/35 dark:text-white/35">
              · {members.length}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close members panel"
          className="rounded p-0.5 text-black/30 transition-colors hover:bg-black/10 hover:text-black/60 dark:text-white/30 dark:hover:bg-white/10 dark:hover:text-white/60"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-1 pb-4">
        {isLoading ? (
          <div className="space-y-2 px-2 pt-4">
            {[70, 55, 80, 65, 75].map((w, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className="h-6 w-6 animate-pulse rounded-full bg-black/10 dark:bg-white/10" />
                <div
                  className="h-3 animate-pulse rounded bg-black/10 dark:bg-white/10"
                  style={{ width: `${w}%` }}
                />
              </div>
            ))}
          </div>
        ) : members.length === 0 ? (
          <p className="px-3 pt-4 text-xs text-black/40 dark:text-white/40">
            No members found.
          </p>
        ) : (
          <>
            {owners.length > 0 && (
              <div>
                <SectionHeader label="Owner" count={owners.length} />
                {owners.map((m) => (
                  <MemberRow
                    key={m.pubkey}
                    member={m}
                    myRole={myRole}
                    isSelf={m.pubkey === myPubkey}
                    onKick={kickMember}
                    onChangeRole={changeRole}
                  />
                ))}
              </div>
            )}
            {admins.length > 0 && (
              <div>
                <SectionHeader label="Admins" count={admins.length} />
                {admins.map((m) => (
                  <MemberRow
                    key={m.pubkey}
                    member={m}
                    myRole={myRole}
                    isSelf={m.pubkey === myPubkey}
                    onKick={kickMember}
                    onChangeRole={changeRole}
                  />
                ))}
              </div>
            )}
            {regular.length > 0 && (
              <div>
                <SectionHeader label="Members" count={regular.length} />
                {regular.map((m) => (
                  <MemberRow
                    key={m.pubkey}
                    member={m}
                    myRole={myRole}
                    isSelf={m.pubkey === myPubkey}
                    onKick={kickMember}
                    onChangeRole={changeRole}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      <div className="shrink-0 space-y-1.5 border-t border-black/10 px-3 py-2.5 dark:border-white/10">
        <button
          type="button"
          onClick={() => setShowConnectAgent(true)}
          className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] font-medium text-black/50 transition-colors hover:bg-black/5 hover:text-black/80 dark:text-white/40 dark:hover:bg-white/5 dark:hover:text-white/70"
        >
          <Zap className="h-3 w-3 text-violet-500/70" />
          Connect agent
        </button>
      </div>

      {showConnectAgent && (
        <ConnectAgentDialog
          groupId={groupId}
          onClose={() => setShowConnectAgent(false)}
        />
      )}
    </aside>
  );
}
