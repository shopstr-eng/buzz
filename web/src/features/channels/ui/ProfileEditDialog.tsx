/**
 * Modal dialog for editing the signed-in user's Nostr kind:0 profile.
 *
 * Publishes a kind:0 event whose content is the updated JSON metadata.
 * Any fields left blank are omitted from the published event.
 */

import { useEffect, useRef, useState } from "react";
import { X, Loader2, UserCircle2 } from "lucide-react";
import { useRelay } from "@/shared/context/relay-context";
import { getSignFn } from "@/shared/lib/identity";
import { useProfiles } from "@/shared/hooks/use-profiles";

interface Props {
  onClose: () => void;
}

export function ProfileEditDialog({ onClose }: Props) {
  const { identity, connection } = useRelay();
  const pubkeys = identity ? [identity.pubkey] : [];
  const profiles = useProfiles(pubkeys);
  const existing = identity ? profiles.get(identity.pubkey) : undefined;

  const [name, setName] = useState("");
  const [about, setAbout] = useState("");
  const [picture, setPicture] = useState("");
  const [imgOk, setImgOk] = useState(true);

  // Pre-fill once the existing profile loads.
  const prefilled = useRef(false);
  useEffect(() => {
    if (prefilled.current || !existing) return;
    prefilled.current = true;
    setName(existing.name ?? "");
    setAbout(existing.about ?? "");
    setPicture(existing.picture ?? "");
  }, [existing]);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Close on Escape.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!connection) return;
    const signFn = getSignFn();
    if (!signFn) {
      setError("No signing key available.");
      return;
    }

    setSaving(true);
    setError(null);
    setSaved(false);

    try {
      const content: Record<string, string> = {};
      if (name.trim()) content.display_name = name.trim();
      if (about.trim()) content.about = about.trim();
      if (picture.trim()) content.picture = picture.trim();

      const signed = await signFn({
        kind: 0,
        created_at: Math.floor(Date.now() / 1000),
        tags: [],
        content: JSON.stringify(content),
      });
      // publishAndWait surfaces relay rejections (permissions, validation)
      // instead of silently pretending the save succeeded.
      await connection.publishAndWait(signed);
      setSaved(true);
      // Close after a short pause so the user sees the confirmation.
      setTimeout(onClose, 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save profile.");
    } finally {
      setSaving(false);
    }
  }

  const avatarSrc = picture.trim() || existing?.picture;

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md overflow-hidden rounded-xl border border-black/10 bg-white shadow-2xl dark:border-white/10 dark:bg-[#1C1C1C]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-black/10 px-5 py-4 dark:border-white/10">
          <h2 className="text-sm font-semibold text-black dark:text-white">
            Edit profile
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-black/30 transition-colors hover:bg-black/5 hover:text-black/60 dark:text-white/30 dark:hover:bg-white/10 dark:hover:text-white/60"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSave} className="space-y-4 px-5 py-5">
          {/* Avatar preview */}
          <div className="flex items-center gap-3">
            <div className="relative h-14 w-14 shrink-0">
              {avatarSrc && imgOk ? (
                <img
                  src={avatarSrc}
                  alt="Avatar preview"
                  className="h-14 w-14 rounded-full object-cover"
                  onError={() => setImgOk(false)}
                />
              ) : (
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-black/10 dark:bg-white/10">
                  <UserCircle2 className="h-8 w-8 text-black/30 dark:text-white/30" />
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <label className="block text-xs font-medium text-black/60 dark:text-white/60">
                Picture URL
              </label>
              <input
                type="url"
                value={picture}
                onChange={(e) => {
                  setPicture(e.target.value);
                  setImgOk(true); // reset error state when URL changes
                }}
                placeholder="https://example.com/avatar.png"
                className="mt-1 w-full rounded-md border border-black/15 bg-transparent px-2.5 py-1.5 text-sm text-black/80 outline-none placeholder:text-black/30 focus:border-violet-500 focus:ring-1 focus:ring-violet-500/30 dark:border-white/15 dark:text-white/80 dark:placeholder:text-white/25"
              />
            </div>
          </div>

          {/* Display name */}
          <label className="block">
            <span className="text-xs font-medium text-black/60 dark:text-white/60">
              Display name
            </span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              placeholder="Your name"
              className="mt-1 w-full rounded-md border border-black/15 bg-transparent px-2.5 py-1.5 text-sm text-black/80 outline-none placeholder:text-black/30 focus:border-violet-500 focus:ring-1 focus:ring-violet-500/30 dark:border-white/15 dark:text-white/80 dark:placeholder:text-white/25"
            />
          </label>

          {/* About */}
          <label className="block">
            <span className="text-xs font-medium text-black/60 dark:text-white/60">
              About
            </span>
            <textarea
              value={about}
              onChange={(e) => setAbout(e.target.value)}
              maxLength={300}
              rows={3}
              placeholder="A short bio…"
              className="mt-1 w-full resize-none rounded-md border border-black/15 bg-transparent px-2.5 py-1.5 text-sm text-black/80 outline-none placeholder:text-black/30 focus:border-violet-500 focus:ring-1 focus:ring-violet-500/30 dark:border-white/15 dark:text-white/80 dark:placeholder:text-white/25"
            />
          </label>

          {/* Footer */}
          <div className="flex items-center gap-3 pt-1">
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {saving ? "Saving…" : "Save profile"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-3 py-2 text-sm text-black/50 transition-colors hover:bg-black/5 dark:text-white/50 dark:hover:bg-white/5"
            >
              Cancel
            </button>

            {saved && (
              <span className="ml-auto text-xs text-emerald-600 dark:text-emerald-400">
                ✓ Profile saved
              </span>
            )}
            {error && (
              <span className="ml-auto text-xs text-red-600 dark:text-red-400">
                {error}
              </span>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
