import { useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { EMOJI_CATEGORIES } from "../emoji-data";
import type { CustomEmoji } from "../use-custom-emoji";

interface Props {
  /** Called with a unicode emoji, or `:shortcode:` + url for custom emoji */
  onSelect: (emoji: string, emojiUrl?: string) => void;
  customEmoji?: CustomEmoji[];
}

/** Full emoji picker: search, category tabs, unicode grid + NIP-30 custom emoji. */
export function EmojiPicker({ onSelect, customEmoji = [] }: Props) {
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState(EMOJI_CATEGORIES[0].id);
  const scrollRef = useRef<HTMLDivElement>(null);

  const q = query.trim().toLowerCase();

  const filteredCustom = useMemo(
    () => (q ? customEmoji.filter((e) => e.shortcode.includes(q)) : customEmoji),
    [customEmoji, q],
  );

  const filteredCategories = useMemo(() => {
    if (!q) return EMOJI_CATEGORIES;
    // Unicode emoji have no names; searching filters custom emoji only and
    // keeps the full unicode grid visible.
    return EMOJI_CATEGORIES;
  }, [q]);

  function scrollToCategory(id: string) {
    setActiveCategory(id);
    const el = scrollRef.current?.querySelector(`[data-emoji-category="${id}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const btnCls =
    "flex h-8 w-8 items-center justify-center rounded text-lg leading-none hover:bg-black/5 dark:hover:bg-white/10";

  return (
    <div className="flex h-72 w-80 flex-col overflow-hidden rounded-lg border border-black/10 bg-white shadow-lg dark:border-white/10 dark:bg-[#252525]">
      {/* Search */}
      <div className="flex shrink-0 items-center gap-2 border-b border-black/10 px-3 py-2 dark:border-white/10">
        <Search className="h-3.5 w-3.5 text-black/30 dark:text-white/30" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search custom emoji…"
          className="flex-1 bg-transparent text-xs text-black placeholder:text-black/35 focus:outline-none dark:text-white dark:placeholder:text-white/35"
        />
      </div>

      {/* Category tabs */}
      {!q && (
        <div className="flex shrink-0 items-center gap-0.5 overflow-x-auto border-b border-black/10 px-2 py-1 dark:border-white/10">
          {customEmoji.length > 0 && (
            <button
              type="button"
              onClick={() => scrollToCategory("custom")}
              title="Custom"
              className={`rounded p-1 text-sm ${activeCategory === "custom" ? "bg-black/10 dark:bg-white/15" : "hover:bg-black/5 dark:hover:bg-white/10"}`}
            >
              ⭐
            </button>
          )}
          {EMOJI_CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => scrollToCategory(cat.id)}
              title={cat.label}
              className={`rounded p-1 text-sm ${activeCategory === cat.id ? "bg-black/10 dark:bg-white/15" : "hover:bg-black/5 dark:hover:bg-white/10"}`}
            >
              {cat.icon}
            </button>
          ))}
        </div>
      )}

      {/* Scrollable grid */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-2 py-1">
        {filteredCustom.length > 0 && (
          <div data-emoji-category="custom">
            <p className="px-1 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-black/40 dark:text-white/40">
              Custom
            </p>
            <div className="flex flex-wrap">
              {filteredCustom.map((e) => (
                <button
                  key={e.shortcode}
                  type="button"
                  title={`:${e.shortcode}:`}
                  onMouseDown={(ev) => { ev.preventDefault(); onSelect(`:${e.shortcode}:`, e.url); }}
                  className={btnCls}
                >
                  <img src={e.url} alt={e.shortcode} className="h-5 w-5 object-contain" loading="lazy" />
                </button>
              ))}
            </div>
          </div>
        )}
        {filteredCategories.map((cat) => (
          <div key={cat.id} data-emoji-category={cat.id}>
            <p className="px-1 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-black/40 dark:text-white/40">
              {cat.label}
            </p>
            <div className="flex flex-wrap">
              {cat.emojis.map((e) => (
                <button
                  key={e}
                  type="button"
                  onMouseDown={(ev) => { ev.preventDefault(); onSelect(e); }}
                  className={btnCls}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
