---
name: OpenRouter as the only keyless provider
description: OpenRouter (Replit AI Integrations) is the sole keyless LLM provider; how the openrouter vs openai-compat distinction is encoded and what must stay consistent.
---

## Rule
OpenRouter is the ONLY keyless provider option. The start script maps
`AI_INTEGRATIONS_OPENROUTER_*` → `OPENAI_COMPAT_*`; there is no Anthropic/OpenAI
keyless mapping anymore (BYOK Anthropic/OpenAI still works via user-set secrets).

**Why:** The user declined managing API keys; Replit AI Integrations covers
OpenRouter keylessly, and OpenRouter serves Anthropic/OpenAI/Google/Moonshot
models through one OpenAI-compatible endpoint.

**How to apply:**
- The keyless path and a BYOK custom endpoint BOTH persist as
  `BUZZ_AGENT_PROVIDER=openai` in `.env.agent` — they are distinguished by
  `OPENAI_COMPAT_BASE_URL`: absent = keyless OpenRouter, present = custom
  endpoint. Never store a base URL for the keyless path, and never allow a
  custom endpoint without one (the admin UI rejects blank baseUrl on save).
- `OPENAI_COMPAT_API=chat` is the fixed dialect (chat completions is the
  universal baseline; `auto` would pick Responses on openai.com hosts).
- Personas/managed agents store models as `openai:<openrouter-id>` (the
  desktop `provider:model-id` contract, split on first colon). The `openai`
  prefix means "OpenAI-compatible wire format", i.e. OpenRouter here.
- The model catalog endpoint (`GET /api/admin/v1/settings/agent-models`,
  owner-only NIP-98, 5-min relay cache) requires `OPENAI_COMPAT_API_KEY` in
  the relay's env — it 404s when the keyless secrets aren't injected (e.g.
  this workspace type, which can't inject managed-AI credentials). Both UIs
  fall back to a static shortlist in that case.
