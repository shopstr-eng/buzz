/**
 * Admin panel — AI Agent Provider Settings.
 *
 * Selects which LLM provider the built-in ACP agent uses.
 * API credentials are supplied automatically by Replit AI Integrations —
 * no key management needed. Usage is billed to the Replit account.
 */

import { useEffect, useState } from "react";
import { post, request } from "./api";

// ── Types ─────────────────────────────────────────────────────────────────

type Provider = "anthropic" | "openai" | null;

interface AgentProviderConfig {
  provider: Provider;
  model: string | null;
  baseUrl: string | null;
  restartRequired: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────

function providerLabel(p: Provider) {
  if (p === "anthropic") return "Anthropic — Claude";
  if (p === "openai") return "OpenAI-compatible";
  return "None (agent disabled)";
}

function defaultModel(p: Provider) {
  if (p === "anthropic") return "claude-opus-4-5";
  if (p === "openai") return "gpt-4o";
  return "";
}

// ── Component ─────────────────────────────────────────────────────────────

export function Settings() {
  const [config, setConfig] = useState<AgentProviderConfig | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Form state
  const [provider, setProvider] = useState<Provider>(null);
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");

  // Submit state
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    request<AgentProviderConfig>("/settings/agent-provider")
      .then((cfg) => {
        setConfig(cfg);
        setProvider(cfg.provider);
        setModel(cfg.model ?? "");
        setBaseUrl(cfg.baseUrl ?? "");
      })
      .catch((err) =>
        setLoadError(err.message ?? "Failed to load settings."),
      );
  }, []);

  useEffect(() => {
    setSaved(false);
  }, [provider, model, baseUrl]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const body: Record<string, string | null> = { provider };
      body.model = model.trim() || null;
      if (provider === "openai") body.baseUrl = baseUrl.trim() || null;
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
          Choose which AI provider the built-in agent uses. Credentials are
          provided automatically by{" "}
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

      {config.restartRequired && (
        <div className="settings-notice settings-notice--warn">
          <strong>Restart required</strong> — the relay is running with a
          different provider than what's saved on disk. Restart it to apply the
          stored configuration.
        </div>
      )}

      <form className="settings-form" onSubmit={handleSave}>
        {/* Provider selector */}
        <fieldset className="settings-fieldset">
          <legend>Provider</legend>

          {(["anthropic", "openai", null] as Provider[]).map((p) => (
            <label key={String(p)} className="settings-radio">
              <input
                type="radio"
                name="provider"
                value={String(p)}
                checked={provider === p}
                onChange={() => {
                  setProvider(p);
                  setModel(defaultModel(p));
                  setBaseUrl("");
                }}
              />
              <span className="settings-radio-body">
                <span className="settings-radio-label">
                  {providerLabel(p)}
                </span>
                {p === "anthropic" && (
                  <span className="settings-radio-hint">
                    Claude Opus 4.5, Sonnet 4.5, Haiku 4 — keyless via Replit
                  </span>
                )}
                {p === "openai" && (
                  <span className="settings-radio-hint">
                    GPT-4o, GPT-4.1, or any OpenAI-compatible endpoint —
                    keyless via Replit, or point to a custom base URL with your
                    own key set as a{" "}
                    <a
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        window.open(
                          "https://docs.replit.com/core-concepts/project-editor/app-setup/secrets",
                          "_blank",
                        );
                      }}
                    >
                      Replit Secret
                    </a>
                  </span>
                )}
                {p === null && (
                  <span className="settings-radio-hint">
                    The agent will not respond to any messages.
                  </span>
                )}
              </span>
            </label>
          ))}
        </fieldset>

        {/* Provider-specific fields */}
        {provider !== null && (
          <fieldset className="settings-fieldset">
            <legend>Options</legend>

            {/* Model (optional) */}
            <label className="settings-field">
              <span className="settings-field-label">
                Model{" "}
                <span className="settings-field-optional">(optional)</span>
              </span>
              <input
                type="text"
                className="settings-input"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder={defaultModel(provider)}
                spellCheck={false}
              />
              <span className="settings-field-hint">
                {provider === "anthropic"
                  ? "e.g. claude-opus-4-5 · claude-sonnet-4-5 · claude-haiku-4-5"
                  : "e.g. gpt-4o · gpt-4.1 · gpt-4o-mini"}
              </span>
            </label>

            {/* Base URL (OpenAI-compat only) */}
            {provider === "openai" && (
              <label className="settings-field">
                <span className="settings-field-label">
                  Base URL{" "}
                  <span className="settings-field-optional">(optional)</span>
                </span>
                <input
                  type="url"
                  className="settings-input"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://api.openai.com/v1"
                  spellCheck={false}
                />
                <span className="settings-field-hint">
                  Override for Azure OpenAI, Ollama, or other compatible
                  endpoints. When using a custom endpoint, add your key as a
                  Replit Secret named <code>OPENAI_API_KEY</code>.
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
            disabled={saving}
          >
            {saving ? "Saving…" : "Save — applies on next restart"}
          </button>

          {saved && (
            <span className="settings-success" role="status">
              ✓ Saved — restart the relay to activate.
            </span>
          )}

          {saveError && (
            <span className="settings-error" role="alert">
              {saveError}
            </span>
          )}
        </div>
      </form>

      {/* Current running state */}
      <div className="settings-current">
        <h2 className="settings-current-title">Currently running</h2>
        <dl className="settings-dl">
          <dt>Provider</dt>
          <dd>
            {config.provider
              ? providerLabel(config.provider)
              : "None (agent disabled)"}
          </dd>
          <dt>Credentials</dt>
          <dd>Replit AI Integrations (keyless)</dd>
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
