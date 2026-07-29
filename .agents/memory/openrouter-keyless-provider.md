---
name: Keyless provider wiring — OpenRouter primary, Anthropic fallback
description: How the built-in agent's keyless credentials are wired; OpenRouter is the sole keyless provider in the standard app (Anthropic fallback removed there 2026-07-29).
---

## Rule
OpenRouter is the SOLE keyless provider (Replit AI Integrations →
`OPENAI_COMPAT_*`). The keyless Anthropic fallback (mapping
`AI_INTEGRATIONS_ANTHROPIC_*` → `ANTHROPIC_*`, falling back to
provider=anthropic when the effective provider couldn't authenticate) was
REMOVED from start-replit.sh on 2026-07-29 after the migration to the
standard app — the Anthropic integration is not attached there, and the
standard app injects `AI_INTEGRATIONS_OPENROUTER_*` directly.

**Why:** the fallback existed only because the OLD workspace type injected
Anthropic secrets but NOT OpenRouter ones — with OpenRouter-only wiring the
agent had zero credentials (`BUZZ_AGENT_PROVIDER` unset → buzz-agent exits
immediately). The standard app removes that constraint, so the fallback
would only mask a missing-OpenRouter-key failure behind a provider that
isn't integrated. If Buzz ever runs in an Anthropic-only-injecting
environment again, restore the fallback block from git history.
A non-empty `.env.agent` (explicit admin-saved config) still always wins
over all auto-defaults.

**How to apply:**
- The keyless OpenRouter path and a BYOK custom endpoint BOTH persist as
  `BUZZ_AGENT_PROVIDER=openai` in `.env.agent` — distinguished by
  `OPENAI_COMPAT_BASE_URL`: absent = keyless OpenRouter, present = custom
  endpoint. Never store a base URL for the keyless path; never allow a
  custom endpoint without one (the admin UI rejects blank baseUrl on save).
- `OPENAI_COMPAT_API=chat` is the fixed dialect (chat completions is the
  universal baseline; `auto` would pick Responses on openai.com hosts).
- Personas/managed agents store models as `openai:<openrouter-id>` (the
  desktop `provider:model-id` contract, split on first colon). The `openai`
  prefix means "OpenAI-compatible wire format", i.e. OpenRouter here.
- The model catalog endpoint (`GET /api/admin/v1/settings/agent-models`,
  owner-only NIP-98, 5-min relay cache) requires `OPENAI_COMPAT_API_KEY` in
  the relay's env — it 404s when the keyless secrets aren't injected (e.g.
  this workspace type). Both UIs fall back to a static shortlist in that case.
- Prod userenv sets `BUZZ_AGENT_PROVIDER=openai` explicitly; with the
  fallback gone, the keyless OpenRouter secrets must be injected in every
  environment or the agent exits on startup.
