import { useState } from "react";
import { X } from "lucide-react";
import { EmojiPicker } from "./EmojiPicker";
import type { CustomEmoji } from "../use-custom-emoji";

interface Props {
  currentText?: string;
  currentEmoji?: string;
  customEmoji?: CustomEmoji[];
  onSave: (text: string, emoji: string) => Promise<void>;
  onClose: () => void;
}

/** Set a custom status (kind 30315): emoji + text, or clear both. */
export function SetStatusDialog({ currentText = "", currentEmoji = "", customEmoji, onSave, onClose }: Props) {
  const [text, setText] = useState(currentText);
  const [emoji, setEmoji] = useState(currentEmoji);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  async function handleSave(clear = false) {
    setSaving(true);
    try {
      await onSave(clear ? "" : text.trim(), clear ? "" : emoji);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onMouseDown={onClose}>
      <div
        className="w-80 rounded-xl border border-black/10 bg-white p-4 shadow-xl dark:border-white/10 dark:bg-[#1E1E1E]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-black dark:text-white">Set a status</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-black/30 hover:text-black/60 dark:text-white/30 dark:hover:text-white/60">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <button
              type="button"
              onClick={() => setPickerOpen((o) => !o)}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-black/15 text-lg hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10"
              title="Choose emoji"
            >
              {emoji || "😀"}
            </button>
            {pickerOpen && (
              <>
                <div className="fixed inset-0 z-10" onMouseDown={() => setPickerOpen(false)} />
                <div className="absolute left-0 top-full z-20 mt-1">
                  <EmojiPicker
                    customEmoji={customEmoji}
                    onSelect={(e) => {
                      setEmoji(e);
                      setPickerOpen(false);
                    }}
                  />
                </div>
              </>
            )}
          </div>
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void handleSave(); }}
            placeholder="What's happening?"
            maxLength={80}
            className="flex-1 rounded-lg border border-black/15 bg-transparent px-3 py-2 text-sm text-black placeholder:text-black/35 focus:border-black/30 focus:outline-none dark:border-white/15 dark:text-white dark:placeholder:text-white/35 dark:focus:border-white/30"
          />
        </div>

        <div className="mt-4 flex items-center justify-between">
          <button
            type="button"
            onClick={() => void handleSave(true)}
            disabled={saving || (!currentText && !currentEmoji)}
            className="text-xs text-black/40 hover:text-red-600 disabled:opacity-40 dark:text-white/40 dark:hover:text-red-400"
          >
            Clear status
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="rounded-lg bg-black px-3 py-1.5 text-xs font-medium text-white hover:opacity-80 disabled:opacity-40 dark:bg-white dark:text-black"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
