---
name: Workspace migration to standard Replit app
description: Why/how this Buzz relay moves to a standard Replit app for managed AI; data + cutover tooling and constraints.
---

## Status (as of 2026-07-29)
- Phases 1-3 DONE: new standard Agent app created, OpenRouter keyless integration attached
  before the repo swap, workspace root replaced with an exact clone of shopstr-eng/buzz,
  identity secrets (BUZZ_RELAY_PRIVATE_KEY, BUZZ_ACP_PRIVATE_KEY, SESSION_SECRET, GITHUB_TOKEN)
  copied from the old app, relay verified booting with the OpenRouter-detection log line.
- Anthropic keyless fallback removed from start-replit.sh in the new app (not integrated there).
- New-app-only fix: platform reserves 127.0.0.1:8080 → health port now BUZZ_HEALTH_PORT=18081
  (see replit-build-quirks.md); .replit ports remapped local 18081 → external 8080.
- Phase 4 (dev data) superseded: user supplied the full old-prod JSON export on 2026-07-29;
  staged at backups/prod-seed.json AND imported into the new dev DB (5 channels, ~350 events).
- Seed FK trap nuance: the one-shot hook (script section 3b) runs BEFORE community seeding,
  so a fresh prod DB has zero community rows at import time and cannot hit the host-conflict
  trap. The trap only bites when importing into an ALREADY-booted DB — the new dev DB had
  auto-seeded loopback communities, so the seed's loopback community ids (127.0.0.1:5000,
  localhost:5000, localhost) were string-remapped to the new dev DB's ids in the staged file
  (73 replacements; also safe for the prod path since remapped ids are just uuids).
- ACP "discovered 0 channels" in the new dev workspace is EXPECTED: the ACP worker binds to
  the dev-domain community, and the imported channels belong to buzz.shopstrmarkets.com /
  buzzstr.replit.app / old riker+janeway hosts.
- Phase 5 (prod cutover) PENDING: publish with BUZZ_CUSTOM_DOMAINS=buzz.shopstrmarkets.com
  set before first boot (seed is already staged and imports before community seeding) →
  verify → DNS flip → retire old app → delete the staged seed file.

## Why
This workspace type cannot use Replit AI Integrations (keyless managed Anthropic/OpenAI):
`searchIntegrations` returns only third-party connectors, `viewIntegration` rejects blueprint
ids ("only connectors and connections are available"), and no managed AI env vars are injected.
Same project-type gap as artifacts being unsupported. **Managed AI works only in standard
Agent apps**, so the project migrates by importing the GitHub repo into a new standard app.
User explicitly declined pasting API keys — keyless/Replit-billed is a hard requirement.

## Tooling in repo (see REPLIT_MIGRATION.md runbook)
- `scripts/start-replit.sh` self-defaults every required env var (bind 0.0.0.0:5000, auth
  and membership flags, RUST_LOG, REDIS_URL) — fresh imports boot with zero env setup.
- `scripts/export-buzz-data.sh` / `import-buzz-data.sh` — dev-data pg_dump tarball round-trip.
- `scripts/import-json-export.sh` — FK-ordered import of a JSON `{table: rows}` export with
  sequence re-sync; ON CONFLICT DO NOTHING so boot-seeded community rows don't abort it.
- One-shot prod seeding: start script imports `backups/prod-seed.json` only when the DB has
  zero channels. VM deploys snapshot the workspace filesystem, so the gitignored seed file
  ships in the image without entering git.

## Constraints worth remembering
- Production DB is read-only from agent tools (`executeSql environment:"production"` hits a
  replica). Prod export must therefore be agent-run SELECT `json_agg` per table; chunk output
  to survive tool-output truncation. Writes to a prod DB happen only from the deployed app
  itself — hence the boot-time seed hook.
- Migration-maintained tables (`_sqlx_migrations`, `_operator_global_tables`) must never be
  copied between apps; target runs its own migrations.
- Identity secrets (`BUZZ_RELAY_PRIVATE_KEY`, `BUZZ_ACP_PRIVATE_KEY`) must be copied to the
  new app BEFORE anyone connects — relay pubkey and agent membership rows derive from them.
- Media blobs are NOT in Postgres — they live in the S3/MinIO bucket (`buzz-media`). A DB
  export/import alone leaves message attachments broken; mirror the bucket or share it via
  `BUZZ_S3_*` secrets on the new app.
- Export/import table coverage must match the `TABLES` array in `scripts/import-json-export.sh`
  exactly; relay_invites was added to that list (durable invite links survive cutover).
- Cutover order: snapshot prod right before DNS flip (messages between snapshot and flip are
  lost); old app stays intact as rollback until DNS verified.

## Prod verification lessons (July 27, 2026)
- The runbook's `curl -H "Host: buzz.shopstrmarkets.com" https://<app>.replit.app/` verification does NOT work: Replit's front proxy routes by Host header before reaching the app, returning 502 for unlinked domains. Verify prod state via read-only prod DB queries (database skill, environment: "production") instead, or /etc/hosts pinning from a local machine.
- Autoscale (cloudrun) prod restarts have a multi-minute cold-boot window (Redis + migrations + seeding) during which all requests, including /admin/, return 500 (healthcheck failures visible in deployment logs). This is transient, not a defect.
- `<app>.replit.app` host intentionally has no communities row → "no community is configured for this host" 404 on the temp URL is expected; data binds to buzz.shopstrmarkets.com only.
- Seed import gotcha: import-json-export.sh uses ON CONFLICT DO NOTHING; if the target DB already has a community row for the same host under a DIFFERENT id, the seed's community row is skipped and all child rows FK-fail, aborting the transaction — and the fail-closed guard crash-loops the boot. Fix: remap seed community ids to the target DB's existing ids (match by host) before staging backups/prod-seed.json. Done July 27, 2026 for the staged seed (prod ids baked in).
