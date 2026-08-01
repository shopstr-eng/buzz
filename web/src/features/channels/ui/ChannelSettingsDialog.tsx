/**
 * Channel settings dialog: edit name + description via kind:9002
 * (NIP-29 Edit Group Metadata). The relay enforces permissions server-side;
 * non-admins get a rejected event.
 */

import { useState } from "react";
import { X } from "lucide-react";
import { useRelay } from "@/shared/context/relay-context";
import { getSignFn } from "@/shared/lib/identity";
import { KIND_EDIT_METADATA, type Channel } from "../types";

import { saveChannelTemplate } from "../use-channel-templates";

interface Props {
  channel: Channel;
  onClose: () => void;
}

export function ChannelSettingsDialog({ channel, onClose }: Props) {
  const { connection } = useRelay();
  const [name, setName] = useState(channel.name);
  const [about, setAbout] = useState(channel.about ?? "");
  const [topic, setTopic] = useState(channel.topic ?? "");
  const [templateSaved, setTemplateSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!connection) return;
    const signFn = getSignFn();
    if (!signFn) {
      setError("No signing key available. Please log in again.");
      return;
    }

    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Name is required.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const tags: string[][] = [["h", channel.groupId]];
      tags.push(["name", trimmedName]);
      if (about.trim()) tags.push(["about", about.trim()]);

      const signed = await signFn({
        kind: KIND_EDIT_METADATA,
        created_at: Math.floor(Date.now() / 1000),
        tags,
        content: "",
      });
      // publishAndWait surfaces the relay's OK false reason (e.g. permission
      // denied for non-admins) instead of silently dropping the edit.
      await connection.publishAndWait(signed);

      // Topic changes mirror desktop's set-topic contract exactly: a
      // standalone kind:9002 carrying only ["h", …] + ["topic", …] tags.
      const trimmedTopic = topic.trim();
      if (trimmedTopic !== (channel.topic ?? "")) {
        const topicSigned = await signFn({
          kind: KIND_EDIT_METADATA,
          created_at: Math.floor(Date.now() / 1000),
          tags: [
            ["h", channel.groupId],
            ["topic", trimmedTopic],
          ],
          content: "",
        });
        await connection.publishAndWait(topicSigned);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onMouseDown={onClose}>
      <div
        className="w-96 rounded-xl border border-black/10 bg-white p-4 shadow-xl dark:border-white/10 dark:bg-[#1E1E1E]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-black dark:text-white">Channel settings</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-black/30 hover:text-black/60 dark:text-white/30 dark:hover:text-white/60"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <label className="mb-1 block text-xs font-medium text-black/60 dark:text-white/60">
          Name
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={60}
          className="mb-3 w-full rounded-lg border border-black/15 bg-transparent px-3 py-2 text-sm text-black focus:border-black/30 focus:outline-none dark:border-white/15 dark:text-white dark:focus:border-white/30"
        />

        <label className="mb-1 block text-xs font-medium text-black/60 dark:text-white/60">
          Topic
        </label>
        <input
          type="text"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          maxLength={200}
          placeholder="What is this channel about right now?"
          className="mb-3 w-full rounded-lg border border-black/15 bg-transparent px-3 py-2 text-sm text-black placeholder:text-black/35 focus:border-black/30 focus:outline-none dark:border-white/15 dark:text-white dark:placeholder:text-white/35 dark:focus:border-white/30"
        />

        <label className="mb-1 block text-xs font-medium text-black/60 dark:text-white/60">
          Description
        </label>
        <textarea
          value={about}
          onChange={(e) => setAbout(e.target.value)}
          maxLength={200}
          rows={3}
          placeholder="What's this channel about?"
          className="mb-3 w-full resize-none rounded-lg border border-black/15 bg-transparent px-3 py-2 text-sm text-black placeholder:text-black/35 focus:border-black/30 focus:outline-none dark:border-white/15 dark:text-white dark:placeholder:text-white/35 dark:focus:border-white/30"
        />

        <button
          type="button"
          onClick={() => {
            saveChannelTemplate({
              name: name.trim() || channel.name,
              about: about.trim(),
              channelType: channel.channelType,
              isPrivate: channel.isPrivate,
              ...(channel.model ? { model: channel.model } : {}),
            });
            setTemplateSaved(true);
          }}
          className="mb-3 w-full rounded-lg border border-black/10 px-3 py-1.5 text-xs text-black/60 hover:bg-black/5 dark:border-white/10 dark:text-white/60 dark:hover:bg-white/10"
        >
          {templateSaved ? "Saved as template ✓" : "Save as template"}
        </button>

        {error && (
          <p className="mb-3 text-xs text-red-600 dark:text-red-400">{error}</p>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-xs text-black/60 hover:bg-black/5 dark:text-white/60 dark:hover:bg-white/10"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="rounded-lg bg-black px-3 py-1.5 text-xs font-medium text-white hover:opacity-80 disabled:opacity-40 dark:bg-white dark:text-black"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
