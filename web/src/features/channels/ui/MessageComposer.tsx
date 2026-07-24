import { useRef, useState, useCallback } from "react";
import { SendHorizonal, AtSign, X, CornerUpLeft, Zap } from "lucide-react";
import type { ChannelMember } from "../use-channel-members";
import type { ChatMessage } from "../types";

interface Props {
  channelName: string;
  onSend: (content: string, mentionPubkeys?: string[], replyToId?: string) => Promise<void>;
  isSending: boolean;
  disabled?: boolean;
  members?: ChannelMember[];
  /** Message being replied to — shows a dismissable banner above the input */
  replyTo?: ChatMessage | null;
  onClearReply?: () => void;
  /** When true, shows workflow-specific slash command hints */
  hasWorkflows?: boolean;
}

function shortKey(pubkey: string) {
  return `${pubkey.slice(0, 8)}\u2026${pubkey.slice(-4)}`;
}

function truncatePubkey(pubkey: string): string {
  return `${pubkey.slice(0, 4)}…${pubkey.slice(-4)}`;
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

/** Scan backwards from cursor to find an active /slash-command query. */
function getSlashAt(text: string, cursor: number): { start: number; query: string } | null {
  // Allow "/cmd" or "@mention /cmd"
  const trimmed = text.slice(0, cursor);
  const slashIdx = trimmed.lastIndexOf("/");
  if (slashIdx === -1) return null;
  // Only treat it as a slash command if the "/" is at the start or after whitespace or a mention
  const before = trimmed.slice(0, slashIdx);
  if (before.length > 0 && !/[\s\u2026]$/.test(before)) return null;
  const query = trimmed.slice(slashIdx + 1);
  // Must be a simple word (no spaces after the slash)
  if (/\s/.test(query)) return null;
  return { start: slashIdx, query: query.toLowerCase() };
}

interface PickerState {
  start: number;
  query: string;
  filtered: ChannelMember[];
}

interface SlashState {
  start: number;
  query: string;
  filtered: SlashCommand[];
}

interface SlashCommand {
  cmd: string;
  description: string;
  example?: string;
}

const SLASH_COMMANDS: SlashCommand[] = [
  { cmd: "/run",     description: "Trigger a workflow by name",    example: "/run deploy" },
  { cmd: "/review",  description: "Ask the agent to review",       example: "/review the last PR" },
  { cmd: "/help",    description: "Ask the agent for help",        example: "/help with this error" },
  { cmd: "/approve", description: "Approve a pending workflow run" },
  { cmd: "/cancel",  description: "Cancel the current workflow run" },
  { cmd: "/summary", description: "Summarise recent activity" },
];

export function MessageComposer({
  channelName,
  onSend,
  isSending,
  disabled,
  members = [],
  replyTo,
  onClearReply,
  hasWorkflows,
}: Props) {
  const [value, setValue] = useState("");
  const [mentionedPubkeys, setMentionedPubkeys] = useState<Set<string>>(new Set());
  const [picker, setPicker] = useState<PickerState | null>(null);
  const [slashPicker, setSlashPicker] = useState<SlashState | null>(null);
  const [pickerIndex, setPickerIndex] = useState(0);
  const [slashIndex, setSlashIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const closePicker = useCallback(() => { setPicker(null); setSlashPicker(null); }, []);

  async function handleSend() {
    const content = value.trim();
    if (!content || isSending || disabled) return;
    const mentions = [...mentionedPubkeys];
    setValue("");
    setMentionedPubkeys(new Set());
    setPicker(null);
    setSlashPicker(null);
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    await onSend(content, mentions.length > 0 ? mentions : undefined, replyTo?.id);
    onClearReply?.();
  }

  function handleInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const newValue = e.target.value;
    setValue(newValue);

    // Auto-grow up to ~6 lines
    const el = e.target;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 144)}px`;

    const cursor = e.target.selectionStart ?? newValue.length;

    // @mention detection (takes priority over slash)
    const mention = getMentionAt(newValue, cursor);
    if (mention && members.length > 0) {
      const q = mention.query.toLowerCase();
      const filtered = members
        .filter((m) => m.pubkey.startsWith(q) || q === "")
        .slice(0, 8);
      if (filtered.length > 0) {
        setPicker({ ...mention, filtered });
        setSlashPicker(null);
        setPickerIndex(0);
        return;
      }
    }
    setPicker(null);

    // Slash-command detection
    const slash = getSlashAt(newValue, cursor);
    if (slash !== null) {
      const filtered = SLASH_COMMANDS.filter((c) =>
        slash.query === "" || c.cmd.slice(1).startsWith(slash.query),
      );
      if (filtered.length > 0) {
        setSlashPicker({ ...slash, filtered });
        setSlashIndex(0);
        return;
      }
    }
    setSlashPicker(null);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Slash-command picker navigation
    if (slashPicker) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashIndex((i) => Math.min(i + 1, slashPicker.filtered.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        selectSlash(slashPicker.filtered[slashIndex]);
        return;
      }
      if (e.key === "Escape") { closePicker(); return; }
    }

    // Mention picker navigation
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
      if (e.key === "Escape") { closePicker(); return; }
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
    const after = value.slice(picker.start + 1 + picker.query.length);
    const inserted = `@${short}`;
    const newValue = `${before}${inserted} ${after}`;
    setValue(newValue);
    setMentionedPubkeys((prev) => new Set([...prev, member.pubkey]));
    setPicker(null);

    setTimeout(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      ta.focus();
      const pos = before.length + inserted.length + 1;
      ta.setSelectionRange(pos, pos);
    }, 0);
  }

  function selectSlash(cmd: SlashCommand) {
    if (!slashPicker) return;
    const before = value.slice(0, slashPicker.start);
    const after = value.slice(slashPicker.start + 1 + slashPicker.query.length);
    // Insert the command with a trailing space so the user can type the argument
    const inserted = `${cmd.cmd} `;
    const newValue = `${before}${inserted}${after}`;
    setValue(newValue);
    setSlashPicker(null);

    setTimeout(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      ta.focus();
      const pos = before.length + inserted.length;
      ta.setSelectionRange(pos, pos);
    }, 0);
  }

  const hasContent = value.trim().length > 0;
  const showHints = members.some((m) => m.isAgent) || hasWorkflows;

  return (
    <div className="relative shrink-0 border-t border-black/10 px-4 py-3 dark:border-white/10">
      {/* Slash-command picker */}
      {slashPicker && (
        <div className="absolute bottom-full left-4 right-4 mb-1 overflow-hidden rounded-lg border border-black/10 bg-white shadow-lg dark:border-white/10 dark:bg-[#1E1E1E]">
          {slashPicker.filtered.map((cmd, idx) => (
            <button
              key={cmd.cmd}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); selectSlash(cmd); }}
              className={`flex w-full items-start gap-2 px-3 py-2 text-left transition-colors ${
                idx === slashIndex
                  ? "bg-violet-50 dark:bg-violet-900/20"
                  : "hover:bg-black/5 dark:hover:bg-white/5"
              }`}
            >
              <Zap className="mt-0.5 h-3 w-3 shrink-0 text-violet-500" />
              <div className="min-w-0">
                <span className="font-mono text-xs font-semibold text-black dark:text-white">
                  {cmd.cmd}
                </span>
                <span className="ml-2 text-xs text-black/50 dark:text-white/50">
                  {cmd.description}
                </span>
                {cmd.example && (
                  <span className="ml-1 font-mono text-[10px] text-black/30 dark:text-white/30">
                    e.g. {cmd.example}
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Mention picker */}
      {picker && (
        <div className="absolute bottom-full left-4 right-4 mb-1 overflow-hidden rounded-lg border border-black/10 bg-white shadow-lg dark:border-white/10 dark:bg-[#1E1E1E]">
          {picker.filtered.map((m, idx) => (
            <button
              key={m.pubkey}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); selectMember(m); }}
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

      {/* Reply-to banner */}
      {replyTo && (
        <div className="mb-2 flex items-center gap-2 rounded-md bg-black/[0.04] px-3 py-1.5 dark:bg-white/[0.06]">
          <CornerUpLeft className="h-3 w-3 shrink-0 text-black/40 dark:text-white/40" />
          <span className="min-w-0 flex-1 truncate text-xs text-black/60 dark:text-white/60">
            <span className="font-semibold">
              {truncatePubkey(replyTo.pubkey)}
            </span>
            {": "}
            {replyTo.content.slice(0, 80)}{replyTo.content.length > 80 ? "…" : ""}
          </span>
          {onClearReply && (
            <button
              type="button"
              onClick={onClearReply}
              className="shrink-0 text-black/30 hover:text-black/60 dark:text-white/30 dark:hover:text-white/60"
            >
              <X className="h-3 w-3" />
            </button>
          )}
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
        {showHints && " · / for commands"}
      </p>
    </div>
  );
}
