/**
 * Searchable model picker for the keyless OpenRouter provider.
 *
 * The stored value is the desktop `provider:model-id` contract (split on the
 * first colon by the runtime resolver). Picking a catalog entry stores
 * `openai:<openrouter-id>`; free text is allowed so custom ids and other
 * providers (`anthropic:…`, `ollama:…`) still type through unchanged.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { useAgentModels } from "../use-agent-models";
import { inputCls } from "./agent-dialog-shell";

const OPENAI_PREFIX = "openai:";

/** Strip the keyless-provider prefix for display; everything else is verbatim. */
function toDisplayModel(stored: string): string {
  return stored.startsWith(OPENAI_PREFIX) ? stored.slice(OPENAI_PREFIX.length) : stored;
}

/** Compose the stored value: bare ids get the keyless provider prefix. */
function toStoredModel(display: string): string {
  const v = display.trim();
  if (!v) return "";
  return v.includes(":") ? v : `${OPENAI_PREFIX}${v}`;
}

/** Provider half of the stored contract, or "" when the model has no prefix. */
export function providerForModel(storedModel: string): string {
  const i = storedModel.indexOf(":");
  return i > 0 ? storedModel.slice(0, i) : "";
}

function formatContext(length: number | null): string | null {
  if (length == null) return null;
  if (length >= 1_000_000) return `${(length / 1_000_000).toFixed(1)}M ctx`;
  if (length >= 1_000) return `${Math.round(length / 1_000)}K ctx`;
  return `${length} ctx`;
}

function formatPrice(perMillion: number | null): string | null {
  if (perMillion == null) return null;
  const rounded = perMillion < 1 ? perMillion.toFixed(2) : perMillion.toFixed(0);
  return `$${rounded}/M`;
}

export function ModelCombobox({
  id,
  value,
  onChange,
  placeholder,
}: {
  id?: string;
  /** Stored `provider:model-id` value (or a bare model id for legacy records). */
  value: string;
  onChange: (stored: string) => void;
  placeholder?: string;
}) {
  const { models, isLoading, isFallback } = useAgentModels();
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const displayValue = toDisplayModel(value);
  const query = displayValue.toLowerCase();
  const filtered = useMemo(() => {
    if (!query) return models;
    return models.filter(
      (m) => m.id.toLowerCase().includes(query) || m.name.toLowerCase().includes(query),
    );
  }, [models, query]);

  const selectedId = displayValue;

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  useEffect(() => {
    setHighlight(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-index="${highlight}"]`)?.scrollIntoView({
      block: "nearest",
    });
  }, [highlight, open]);

  function pick(modelId: string) {
    onChange(`${OPENAI_PREFIX}${modelId}`);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      const delta = e.key === "ArrowDown" ? 1 : -1;
      setHighlight((h) => Math.min(Math.max(h + delta, 0), Math.max(filtered.length - 1, 0)));
    } else if (e.key === "Enter" && open && filtered[highlight]) {
      e.preventDefault();
      pick(filtered[highlight].id);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="relative" ref={containerRef}>
      <input
        id={id}
        className={`${inputCls} pr-8`}
        value={displayValue}
        placeholder={placeholder ?? "anthropic/claude-opus-4.5"}
        onChange={(e) => {
          onChange(toStoredModel(e.target.value));
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        autoComplete="off"
        spellCheck={false}
        role="combobox"
        aria-expanded={open}
        aria-controls={id ? `${id}-listbox` : undefined}
        aria-autocomplete="list"
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label={open ? "Close model list" : "Open model list"}
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-black/35 hover:text-black/60 dark:text-white/35 dark:hover:text-white/60"
        onClick={() => setOpen((o) => !o)}
      >
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <ChevronsUpDown className="h-4 w-4" />
        )}
      </button>
      {open && (
        <ul
          id={id ? `${id}-listbox` : undefined}
          ref={listRef}
          role="listbox"
          className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-black/10 bg-white py-1 shadow-lg dark:border-white/10 dark:bg-[#242424]"
        >
          {isLoading && (
            <li className="px-3 py-2 text-xs text-black/45 dark:text-white/45">
              Loading OpenRouter catalog…
            </li>
          )}
          {!isLoading && filtered.length === 0 && (
            <li className="px-3 py-2 text-xs text-black/45 dark:text-white/45">
              No catalog match — the typed id is used as-is.
            </li>
          )}
          {filtered.slice(0, 100).map((m, i) => {
            const meta = [formatContext(m.context_length), formatPrice(m.prompt_per_million)]
              .filter(Boolean)
              .join(" · ");
            const selected = m.id === selectedId;
            return (
              <li key={m.id} role="option" aria-selected={selected} data-index={i}>
                <button
                  type="button"
                  className={`flex w-full items-start gap-2 px-3 py-1.5 text-left hover:bg-black/5 dark:hover:bg-white/10 ${
                    i === highlight ? "bg-black/5 dark:bg-white/10" : ""
                  }`}
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => pick(m.id)}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-black dark:text-white">
                      {m.name}
                    </span>
                    <span className="block truncate text-[11px] text-black/45 dark:text-white/45">
                      {m.id}
                      {meta ? ` · ${meta}` : ""}
                    </span>
                  </span>
                  {selected && <Check className="mt-1 h-4 w-4 shrink-0 text-violet-600" />}
                </button>
              </li>
            );
          })}
          {isFallback && !isLoading && (
            <li className="border-t border-black/8 px-3 py-1.5 text-[10px] text-black/40 dark:border-white/8 dark:text-white/40">
              Live catalog unavailable — showing a shortlist. Any model id can be typed.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
