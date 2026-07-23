import { useRef, useState } from "react";
import { SendHorizonal } from "lucide-react";

interface Props {
  channelName: string;
  onSend: (content: string) => Promise<void>;
  isSending: boolean;
  disabled?: boolean;
}

export function MessageComposer({
  channelName,
  onSend,
  isSending,
  disabled,
}: Props) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  async function handleSend() {
    const content = value.trim();
    if (!content || isSending || disabled) return;
    setValue("");
    // Reset height
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    await onSend(content);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  function handleInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setValue(e.target.value);
    // Auto-grow textarea up to ~6 lines
    const el = e.target;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 144)}px`;
  }

  return (
    <div className="shrink-0 border-t border-black/10 px-4 py-3 dark:border-white/10">
      <div className="flex items-end gap-2 rounded-xl border border-black/15 bg-white px-3 py-2 focus-within:border-black/30 focus-within:ring-1 focus-within:ring-black/10 dark:border-white/15 dark:bg-white/5 dark:focus-within:border-white/30 dark:focus-within:ring-white/5">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          placeholder={`Message #${channelName}`}
          rows={1}
          disabled={disabled || isSending}
          className="max-h-36 min-h-[1.5rem] flex-1 resize-none bg-transparent text-sm text-black placeholder:text-black/35 focus:outline-none disabled:opacity-50 dark:text-white dark:placeholder:text-white/35"
        />
        <button
          type="button"
          onClick={() => void handleSend()}
          disabled={!value.trim() || isSending || disabled}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-black text-white transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-30 dark:bg-white dark:text-black"
          aria-label="Send message"
        >
          <SendHorizonal className="h-3.5 w-3.5" />
        </button>
      </div>
      <p className="mt-1.5 text-[11px] text-black/30 dark:text-white/30">
        Enter to send · Shift+Enter for new line
      </p>
    </div>
  );
}
