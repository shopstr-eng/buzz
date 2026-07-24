import { useRef, useState, useCallback } from "react";
import { SendHorizonal, AtSign } from "lucide-react";
import type { ChannelMember } from "../use-channel-members";

interface Props {
  channelName: string;
  onSend: (content: string, mentionPubkeys?: string[]) => Promise<void>;
  isSending: boolean;
  disabled?: boolean;
  members?: ChannelMember[];
}

function shortKey(pubkey: string) {
  return `${pubkey.slice(0, 8)}\u2026${pubkey.slice(-4)}`;
}

/** Scan backwards from cursor to find an active @mention query. */
function getMentionAt(text: string, cursor: number): { start: number; query: string } | null {
  let i = cursor - 1;
  while (i >= 0 && text[i] !== " " && text[i] !== "\n") {
    if (text[i] === "@") {
      return { start: i, query: text.slice(i + 1, cursor) };
    }
    i--;
  }
  return null;
}

interface PickerState {
  start: number;
  query: string;
  filtered: ChannelMember[];
}

export function MessageComposer({
  channelName,
  onSend,
  isSending,
  disabled,
  members = [],
}: Props) {
  const [value, setValue] = useState("");
  const [mentionedPubkeys, setMentionedPubkeys] = useState<Set<string>>(new Set());
  const [picker, setPicker] = useState<PickerState | null>(null);
  const [pickerIndex, setPickerIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const closePicker = useCallback(() => setPicker(null), []);

  async function handleSend() {
    const content = value.trim();
    if (!content || isSending || disabled) return;
    const mentions = [...mentionedPubkeys];
    setValue("");
    setMentionedPubkeys(new Set());
    setPicker(null);
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    await onSend(content, mentions.length > 0 ? mentions : undefined);
  }

  function handleInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const newValue = e.target.value;
    setValue(newValue);

    // Auto-grow up to ~6 lines
    const el = e.target;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 144)}px`;

    // Detect @mention context
    const cursor = e.target.selectionStart ?? newValue.length;
    const mention = getMentionAt(newValue, cursor);
    if (mention && members.length > 0) {
      const q = mention.query.toLowerCase();
      const filtered = members
        .filter((m) => m.pubkey.startsWith(q) || q === "")
        .slice(0, 8);
      if (filtered.length > 0) {
        setPicker({ ...mention, filtered });
        setPickerIndex(0);
        return;
      }
    }
    setPicker(null);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (picker) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setPickerIndex((i) => Math.min(i + 1, picker.filtered.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setPickerIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        selectMember(picker.filtered[pickerIndex]);
        return;
      }
      if (e.key === "Escape") {
        closePicker();
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  function selectMember(member: ChannelMember) {
    if (!picker) return;
    const short = shortKey(member.pubkey);
    const before = value.slice(0, picker.start);
    // Replace @query with @shortKey
    const after = value.slice(picker.start + 1 + picker.query.length);
    const inserted = `@${short}`;
    const newValue = `${before}${inserted} ${after}`;
    setValue(newValue);
    setMentionedPubkeys((prev) => new Set([...prev, member.pubkey]));
    setPicker(null);

    // Re-focus textarea and place cursor after the inserted mention
    setTimeout(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      ta.focus();
      const pos = before.length + inserted.length + 1;
      ta.setSelectionRange(pos, pos);
    }, 0);
  }

  const hasContent = value.trim().length > 0;

  return (
    <div className="relative shrink-0 border-t border-black/10 px-4 py-3 dark:border-white/10">
      {/* Mention picker — floats above the composer */}
      {picker && (
        <div className="absolute bottom-full left-4 right-4 mb-1 overflow-hidden rounded-lg border border-black/10 bg-white shadow-lg dark:border-white/10 dark:bg-[#1E1E1E]">
          {picker.filtered.map((m, idx) => (
            <button
              key={m.pubkey}
              type="button"
              onMouseDown={(e) => {
                // Prevent textarea blur before click fires
                e.preventDefault();
                selectMember(m);
              }}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors ${
                idx === pickerIndex
                  ? "bg-violet-50 dark:bg-violet-900/20"
                  : "hover:bg-black/5 dark:hover:bg-white/5"
              }`}
            >
              <AtSign className="h-3 w-3 shrink-0 text-violet-500" />
              <span className="font-mono text-black/70 dark:text-white/70">
                {shortKey(m.pubkey)}
              </span>
              {m.isAgent && (
                <span className="ml-auto rounded bg-violet-100 px-1 py-0.5 text-[10px] font-medium text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
                  Agent
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2 rounded-xl border border-black/15 bg-white px-3 py-2 focus-within:border-black/30 focus-within:ring-1 focus-within:ring-black/10 dark:border-white/15 dark:bg-white/5 dark:focus-within:border-white/30 dark:focus-within:ring-white/5">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          onBlur={closePicker}
          placeholder={`Message #${channelName}`}
          rows={1}
          disabled={disabled || isSending}
          className="max-h-36 min-h-[1.5rem] flex-1 resize-none bg-transparent text-sm text-black placeholder:text-black/35 focus:outline-none disabled:opacity-50 dark:text-white dark:placeholder:text-white/35"
        />
        <button
          type="button"
          onClick={() => void handleSend()}
          disabled={!hasContent || isSending || disabled}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-black text-white transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-30 dark:bg-white dark:text-black"
          aria-label="Send message"
        >
          <SendHorizonal className="h-3.5 w-3.5" />
        </button>
      </div>
      <p className="mt-1.5 text-[11px] text-black/30 dark:text-white/30">
        Enter to send · Shift+Enter for new line
        {members.length > 0 && " · @ to mention"}
      </p>
    </div>
  );
}
