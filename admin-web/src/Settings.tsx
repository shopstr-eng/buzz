/**
 * Admin panel — AI Agent Provider Settings.
 *
 * Selects which LLM provider the built-in ACP agent uses. OpenRouter is the
 * keyless option: credentials are supplied automatically by Replit AI
 * Integrations — no key management needed, usage billed to the Replit
 * account. A custom OpenAI-compatible endpoint (BYOK) is also supported.
 */

import { useEffect, useRef, useState } from "react";
import { post, request } from "./api";

// ── Types ─────────────────────────────────────────────────────────────────

/** "openrouter" and "openai-compat" both persist as provider="openai" — the
 * presence of a baseUrl distinguishes a custom endpoint from the keyless
 * OpenRouter path (whose base URL comes from AI_INTEGRATIONS_OPENROUTER_*). */
type ProviderChoice = "openrouter" | "openai-compat" | null;

interface AgentProviderConfig {
  provider: string | null;
  model: string | null;
  baseUrl: string | null;
  restartRequired: boolean;
}

interface CatalogModel {
  id: string;
  name: string;
  context_length: number | null;
  prompt_per_million: number | null;
  completion_per_million: number | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────

const OPENROUTER_DEFAULT_MODEL = "anthropic/claude-opus-4.5";

/** Shortlist used when the live OpenRouter catalog can't be fetched. */
const FALLBACK_MODELS: CatalogModel[] = [
  { id: "anthropic/claude-opus-4.5", name: "Anthropic: Claude Opus 4.5", context_length: null, prompt_per_million: null, completion_per_million: null },
  { id: "anthropic/claude-sonnet-4.5", name: "Anthropic: Claude Sonnet 4.5", context_length: null, prompt_per_million: null, completion_per_million: null },
  { id: "openai/gpt-5.2", name: "OpenAI: GPT-5.2", context_length: null, prompt_per_million: null, completion_per_million: null },
  { id: "google/gemini-3-pro", name: "Google: Gemini 3 Pro", context_length: null, prompt_per_million: null, completion_per_million: null },
  { id: "moonshotai/kimi-k3", name: "Moonshot: Kimi K3", context_length: null, prompt_per_million: null, completion_per_million: null },
];

function choiceLabel(
  choice: ProviderChoice,
  baseUrl: string | null,
): string {
  if (choice === "openrouter") return "OpenRouter — keyless";
  if (choice === "openai-compat")
    return `OpenAI-compatible${baseUrl ? ` (${baseUrl})` : ""}`;
  return "None (agent disabled)";
}

/** Label for the *running* config — unlike the form preselect, this must
 * show the actual provider, including the keyless Anthropic fallback the
 * start script applies when OpenRouter credentials aren't injected. */
function runningProviderLabel(cfg: AgentProviderConfig): string {
  if (cfg.provider === "anthropic") return "Anthropic — keyless (fallback)";
  return choiceLabel(choiceFor(cfg), cfg.baseUrl);
}

/** Map a stored config back to the UI's provider choice. */
function choiceFor(cfg: AgentProviderConfig): ProviderChoice {
  if (cfg.provider === "openai" || cfg.provider === "openai-compat") {
    return cfg.baseUrl ? "openai-compat" : "openrouter";
  }
  if (cfg.provider === null) return null;
  // Legacy saved values (e.g. "anthropic" from the removed keyless block):
  // preselect OpenRouter; takes effect only if the admin saves.
  return "openrouter";
}

// ── Component ─────────────────────────────────────────────────────────────

export function Settings() {
  const [config, setConfig] = useState<AgentProviderConfig | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Form state
  const [choice, setChoice] = useState<ProviderChoice>("openrouter");
  const [model, setModel] = useState(OPENROUTER_DEFAULT_MODEL);
  const [baseUrl, setBaseUrl] = useState("");

  // Model catalog (OpenRouter keyless path)
  const [catalog, setCatalog] = useState<CatalogModel[]>([]);
  const [catalogFallback, setCatalogFallback] = useState(false);

  // Submit state
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Restart state
  const [restarting, setRestarting] = useState(false);
  const [restartError, setRestartError] = useState<string | null>(null);
  const [restartCountdown, setRestartCountdown] = useState<number | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    request<AgentProviderConfig>("/settings/agent-provider")
      .then((cfg) => {
        setConfig(cfg);
        const c = choiceFor(cfg);
        setChoice(c);
        setModel(
          cfg.model ??
            (c === "openrouter" ? OPENROUTER_DEFAULT_MODEL : ""),
        );
        setBaseUrl(cfg.baseUrl ?? "");
      })
      .catch((err) =>
        setLoadError(err.message ?? "Failed to load settings."),
      );
  }, []);

  useEffect(() => {
    request<CatalogModel[]>("/settings/agent-models")
      .then((models) => {
        if (Array.isArray(models) && models.length > 0) {
          setCatalog(models);
        } else {
          setCatalog(FALLBACK_MODELS);
          setCatalogFallback(true);
        }
      })
      .catch(() => {
        setCatalog(FALLBACK_MODELS);
        setCatalogFallback(true);
      });
  }, []);

  useEffect(() => {
    setSaved(false);
  }, [choice, model, baseUrl]);

  // Cleanup countdown on unmount
  useEffect(() => () => {
    if (countdownRef.current) clearInterval(countdownRef.current);
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    // A custom endpoint without a base URL is indistinguishable from the
    // keyless OpenRouter path on load (both persist as provider="openai"
    // with no baseUrl) — reject it instead of silently switching modes.
    if (choice === "openai-compat" && !baseUrl.trim()) {
      setSaveError("Base URL is required for a custom OpenAI-compatible endpoint.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const body: Record<string, string | null> = {
        // Both OpenRouter and custom endpoints persist as provider="openai";
        // the keyless OpenRouter path is identified by the absence of a
        // base URL (the start script maps AI_INTEGRATIONS_OPENROUTER_*).
        provider: choice === null ? null : "openai",
      };
      if (choice === "openrouter") {
        body.model = model.trim() || OPENROUTER_DEFAULT_MODEL;
        body.baseUrl = "";
      } else if (choice === "openai-compat") {
        body.model = model.trim() || null;
        body.baseUrl = baseUrl.trim() || null;
      }
      const updated = await post<AgentProviderConfig>(
        "/settings/agent-provider",
        body,
      );
      setConfig(updated);
      setSaved(true);
    } catch (err: unknown) {
      setSaveError(
        err instanceof Error ? err.message : "Failed to save settings.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleRestart() {
    setRestarting(true);
    setRestartError(null);
    setRestartCountdown(null);
    try {
      await post<{ ok: boolean }>("/restart", {});
      // Relay will shut down in ~300ms. Poll until it's back up, then reload.
      // We wait at least 2 seconds before polling so we don't catch the relay
      // before it has had a chance to shut down.
      let secs = 15; // max wait
      setRestartCountdown(secs);
      let relayDown = false;
      countdownRef.current = setInterval(async () => {
        secs -= 1;
        setRestartCountdown(secs);

        // After 2s the relay should be down; start probing for it to come back.
        if (secs <= 13) {
          try {
            const r = await fetch("/assets/relay-info.json", { cache: "no-store" });
            if (r.ok) {
              if (relayDown) {
                // Relay is back up — reload now.
                clearInterval(countdownRef.current!);
                countdownRef.current = null;
                window.location.reload();
                return;
              }
            } else {
              relayDown = true;
            }
          } catch {
            relayDown = true;
          }
        }

        if (secs <= 0) {
          clearInterval(countdownRef.current!);
          countdownRef.current = null;
          window.location.reload();
        }
      }, 1000);
    } catch (err: unknown) {
      setRestartError(
        err instanceof Error ? err.message : "Failed to restart relay.",
      );
      setRestarting(false);
    }
  }

  if (loadError) {
    return (
      <section>
        <div className="state error" role="alert">
          <h2>Could not load settings</h2>
          <p>{loadError}</p>
        </div>
      </section>
    );
  }

  if (!config) {
    return (
      <section>
        <div className="state">Loading…</div>
      </section>
    );
  }

  return (
    <section>
      <header className="page-title">
        <p>Configuration</p>
        <h1>AI Agent Provider</h1>
        <span>
          Choose which AI provider the built-in agent uses. OpenRouter
          credentials are provided automatically by{" "}
          <a
            href="https://docs.replit.com/features/integrations/replit-ai-integrations"
            target="_blank"
            rel="noreferrer"
          >
            Replit AI Integrations
          </a>{" "}
          — no API key required. Usage is billed to your Replit account.
        </span>
      </header>

      {/* Restart required notice */}
      {config.restartRequired && !restarting && (
        <div className="settings-notice settings-notice--warn">
          <strong>Restart required</strong> — the relay is running with a
          different provider than what's saved on disk. Restart it to apply the
          stored configuration.
        </div>
      )}

      {/* Restarting feedback */}
      {restarting && restartCountdown !== null && (
        <div className="settings-notice settings-notice--info">
          <strong>Relay is restarting…</strong> Page will refresh in{" "}
          {restartCountdown}s.
        </div>
      )}

      <form className="settings-form" onSubmit={handleSave}>
        {/* Provider selector */}
        <fieldset className="settings-fieldset">
          <legend>Provider</legend>

          {(["openrouter", "openai-compat", null] as ProviderChoice[]).map(
            (p) => (
              <label key={String(p)} className="settings-radio">
                <input
                  type="radio"
                  name="provider"
                  value={String(p)}
                  checked={choice === p}
                  onChange={() => {
                    setChoice(p);
                    setModel(
                      p === "openrouter" ? OPENROUTER_DEFAULT_MODEL : "",
                    );
                    setBaseUrl("");
                  }}
                />
                <span className="settings-radio-body">
                  <span className="settings-radio-label">
                    {choiceLabel(p, null)}
                  </span>
                  {p === "openrouter" && (
                    <span className="settings-radio-hint">
                      Claude, GPT, Gemini, Kimi and 200+ other models —
                      keyless via Replit AI Integrations
                    </span>
                  )}
                  {p === "openai-compat" && (
                    <span className="settings-radio-hint">
                      Point to Azure OpenAI, Ollama, or any compatible
                      endpoint with your own key set as a Replit Secret named{" "}
                      <code>OPENAI_COMPAT_API_KEY</code>
                    </span>
                  )}
                  {p === null && (
                    <span className="settings-radio-hint">
                      The agent will not respond to any messages.
                    </span>
                  )}
                </span>
              </label>
            ),
          )}
        </fieldset>

        {/* Provider-specific fields */}
        {choice !== null && (
          <fieldset className="settings-fieldset">
            <legend>Options</legend>

            {/* Model */}
            <label className="settings-field">
              <span className="settings-field-label">
                Model{" "}
                {choice === "openai-compat" && (
                  <span className="settings-field-optional">(optional)</span>
                )}
              </span>
              <input
                type="text"
                className="settings-input"
                list="agent-model-catalog"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder={
                  choice === "openrouter" ? OPENROUTER_DEFAULT_MODEL : "gpt-4o"
                }
                spellCheck={false}
              />
              {choice === "openrouter" && (
                <datalist id="agent-model-catalog">
                  {catalog.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </datalist>
              )}
              <span className="settings-field-hint">
                {choice === "openrouter"
                  ? catalog.length > 0 && !catalogFallback
                    ? "Pick from the live OpenRouter catalog or type any model id."
                    : "e.g. anthropic/claude-opus-4.5 · openai/gpt-5.2 · google/gemini-3-pro · moonshotai/kimi-k3"
                  : "e.g. gpt-4o · gpt-4.1 · gpt-4o-mini"}
              </span>
            </label>

            {/* Base URL (custom endpoint only) */}
            {choice === "openai-compat" && (
              <label className="settings-field">
                <span className="settings-field-label">Base URL</span>
                <input
                  type="url"
                  className="settings-input"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://api.openai.com/v1"
                  spellCheck={false}
                  required
                />
                <span className="settings-field-hint">
                  Required — distinguishes this endpoint from the keyless
                  OpenRouter path. Your key is read from the{" "}
                  <code>OPENAI_COMPAT_API_KEY</code> secret.
                </span>
              </label>
            )}
          </fieldset>
        )}

        {/* Save */}
        <div className="settings-actions">
          <button
            type="submit"
            className="settings-save-btn"
            disabled={saving || restarting}
          >
            {saving ? "Saving…" : "Save — applies on next restart"}
          </button>

          {saved && (
            <span className="settings-success" role="status">
              ✓ Saved
            </span>
          )}

          {saveError && (
            <span className="settings-error" role="alert">
              {saveError}
            </span>
          )}
        </div>
      </form>

      {/* Restart relay */}
      <div className="settings-restart">
        <div className="settings-restart-info">
          <strong>Restart relay</strong>
          <span>
            Applies saved provider settings and reloads the agent. The relay
            will be unavailable for a few seconds.
          </span>
        </div>
        <button
          type="button"
          className="settings-restart-btn"
          onClick={handleRestart}
          disabled={restarting}
        >
          {restarting
            ? restartCountdown !== null
              ? `Restarting… (${restartCountdown}s)`
              : "Sending…"
            : "Restart relay"}
        </button>
        {restartError && (
          <span className="settings-error" role="alert">
            {restartError}
          </span>
        )}
      </div>

      {/* Current running state */}
      <div className="settings-current">
        <h2 className="settings-current-title">Currently running</h2>
        <dl className="settings-dl">
          <dt>Provider</dt>
          <dd>{runningProviderLabel(config)}</dd>
          <dt>Credentials</dt>
          <dd>
            {config.provider === "anthropic"
              ? "Replit AI Integrations (keyless Anthropic)"
              : config.provider
                ? config.baseUrl
                  ? "OPENAI_COMPAT_API_KEY (your own secret)"
                  : "Replit AI Integrations (keyless OpenRouter)"
                : "—"}
          </dd>
          {config.model && (
            <>
              <dt>Model</dt>
              <dd>
                <code>{config.model}</code>
              </dd>
            </>
          )}
          {config.baseUrl && (
            <>
              <dt>Base URL</dt>
              <dd>
                <code>{config.baseUrl}</code>
              </dd>
            </>
          )}
        </dl>
      </div>
    </section>
  );
}
