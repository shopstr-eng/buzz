import { useState } from "react";
import type { Profile } from "@/shared/hooks/use-profiles";
import { usePresenceMap, type PresenceStatus } from "../use-presence";
import { useUserStatusMap } from "../use-user-status";

function avatarColor(pubkey: string): string {
  const colors = [
    "#e35b4e", "#e8864d", "#d4a017", "#4caf73",
    "#3b9dd3", "#7b72e9", "#c264d0", "#e05b8c",
  ];
  let hash = 0;
  for (let i = 0; i < pubkey.length; i++) {
    hash = (hash * 31 + pubkey.charCodeAt(i)) >>> 0;
  }
  return colors[hash % colors.length];
}

function truncatePubkey(pubkey: string): string {
  return `${pubkey.slice(0, 8)}…${pubkey.slice(-4)}`;
}

const PRESENCE_DOT: Record<PresenceStatus, string> = {
  online: "bg-emerald-500",
  away: "bg-amber-500",
  offline: "bg-black/30 dark:bg-white/30",
};

/** Hover-card style profile popover (avatar, name, presence, custom status). */
export function ProfilePopover({
  pubkey,
  profile,
  onClose,
}: {
  pubkey: string;
  profile?: Profile;
  onClose: () => void;
}) {
  const presence = usePresenceMap();
  const statuses = useUserStatusMap();
  const [imgFailed, setImgFailed] = useState(false);

  const status = presence.get(pubkey) ?? "offline";
  const userStatus = statuses.get(pubkey);
  const name = profile?.name ?? truncatePubkey(pubkey);
  const bg = avatarColor(pubkey);

  return (
    <>
      <div className="fixed inset-0 z-20" onMouseDown={onClose} />
      <div className="absolute left-0 top-full z-30 mt-1 w-64 rounded-xl border border-black/10 bg-white p-3 shadow-xl dark:border-white/10 dark:bg-[#252525]">
        <div className="flex items-start gap-3">
          {profile?.picture && !imgFailed ? (
            <img
              src={profile.picture}
              alt=""
              className="h-12 w-12 rounded-full object-cover"
              onError={() => setImgFailed(true)}
            />
          ) : (
            <div
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-lg font-semibold text-white"
              style={{ backgroundColor: bg }}
            >
              {(name[0] ?? "?").toUpperCase()}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-black dark:text-white">{name}</p>
            <p className="font-mono text-[10px] text-black/40 dark:text-white/40" title={pubkey}>
              {truncatePubkey(pubkey)}
            </p>
            <p className="mt-1 flex items-center gap-1.5 text-[11px] text-black/50 dark:text-white/50">
              <span className={`h-2 w-2 rounded-full ${PRESENCE_DOT[status]}`} />
              {status === "online" ? "Online" : status === "away" ? "Away" : "Offline"}
            </p>
            {userStatus && (userStatus.text || userStatus.emoji) && (
              <p className="mt-1 truncate text-[11px] text-black/60 dark:text-white/60">
                {userStatus.emoji} {userStatus.text}
              </p>
            )}
            {profile?.about && (
              <p className="mt-1.5 line-clamp-2 text-[11px] text-black/50 dark:text-white/50">
                {profile.about}
              </p>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
