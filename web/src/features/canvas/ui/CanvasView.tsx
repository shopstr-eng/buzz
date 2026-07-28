/**
 * Channel canvas tab: shared markdown document (kind 40100), view + edit.
 */

import { useState } from "react";
import Markdown from "react-markdown";
import { Loader, Pencil, Save, X } from "lucide-react";
import { useCanvas } from "../use-canvas";
import { useRelay } from "@/shared/context/relay-context";
import { relativeTime } from "@/shared/lib/relative-time";
import type { Channel } from "../../channels/types";

export function CanvasView({ channel }: { channel: Channel }) {
  const { identity } = useRelay();
  const { canvas, isLoading, saveCanvas } = useCanvas(channel.groupId);
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  function startEdit() {
    setDraft(canvas?.content ?? "");
    setIsEditing(true);
  }

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    try {
      await saveCanvas(draft);
      setIsEditing(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center justify-between border-b border-black/10 px-4 py-2 dark:border-white/10">
        <span className="text-xs text-black/40 dark:text-white/40">
          {canvas
            ? `Last edited ${relativeTime(canvas.updatedAt)}`
            : "No canvas yet"}
        </span>
        {identity && !isEditing && (
          <button
            type="button"
            onClick={startEdit}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-black/50 hover:bg-black/5 hover:text-black dark:text-white/50 dark:hover:bg-white/5 dark:hover:text-white"
          >
            <Pencil className="h-3.5 w-3.5" /> {canvas ? "Edit" : "Create"}
          </button>
        )}
        {isEditing && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
              className="flex items-center gap-1 rounded-md bg-black px-2 py-1 text-xs font-medium text-white hover:opacity-80 disabled:opacity-40 dark:bg-white dark:text-black"
            >
              <Save className="h-3.5 w-3.5" /> Save
            </button>
            <button
              type="button"
              onClick={() => setIsEditing(false)}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-black/50 hover:bg-black/5 dark:text-white/50 dark:hover:bg-white/5"
            >
              <X className="h-3.5 w-3.5" /> Cancel
            </button>
          </div>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {isLoading ? (
          <p className="flex items-center justify-center gap-2 pt-8 text-xs text-black/35 dark:text-white/35">
            <Loader className="h-3.5 w-3.5 animate-spin" /> Loading canvas…
          </p>
        ) : isEditing ? (
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="# Channel canvas&#10;&#10;Shared notes, plans, links — markdown supported."
            autoFocus
            className="h-full min-h-64 w-full resize-none rounded-lg border border-black/10 bg-transparent p-3 font-mono text-sm text-black placeholder:font-sans placeholder:text-black/35 focus:border-black/30 focus:outline-none dark:border-white/10 dark:text-white dark:placeholder:text-white/35 dark:focus:border-white/30"
          />
        ) : canvas?.content ? (
          <div className="prose prose-sm max-w-none text-black dark:prose-invert dark:text-white">
            <Markdown>{canvas.content}</Markdown>
          </div>
        ) : (
          <p className="pt-8 text-center text-xs text-black/35 dark:text-white/35">
            This channel has no canvas yet — a shared markdown doc for notes,
            plans, and links.
          </p>
        )}
      </div>
    </div>
  );
}
