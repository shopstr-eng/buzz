---
name: Keyless provider wiring — OpenRouter primary, Anthropic fallback
description: How the built-in agent's keyless credentials are wired; OpenRouter is primary but Anthropic keyless is an automatic fallback because this workspace type can't inject OpenRouter secrets.
---

## Rule
OpenRouter is the PRIMARY keyless provider (Replit AI Integrations →
`OPENAI_COMPAT_*`). However, `start-replit.sh` also maps
`AI_INTEGRATIONS_ANTHROPIC_*` → `ANTHROPIC_*` and **falls back to
`provider=anthropic`** whenever the effective provider cannot authenticate:
provider unset, or provider=openai/openai-compat with no
`OPENAI_COMPAT_API_KEY`. The fallback is skipped when a non-empty
`.env.agent` exists (explicit admin-saved config always wins).

**Why:** This workspace type injects `AI_INTEGRATIONS_ANTHROPIC_*` but NOT
`AI_INTEGRATIONS_OPENROUTER_*`. When the Anthropic mapping was removed in
favor of OpenRouter-only, the agent had zero credentials — `BUZZ_AGENT_PROVIDER`
unset → buzz-agent exits immediately, and the built-in agent silently stopped
responding in both dev and prod. Do not remove the Anthropic fallback until
the workspace migrates to a standard app that injects the OpenRouter secrets.

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
- Prod userenv sets `BUZZ_AGENT_PROVIDER=openai` explicitly; the fallback
  overrides that when the key is missing, so prod self-heals on republish.
