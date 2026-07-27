---
name: Workspace migration to standard Replit app
description: Why/how this Buzz relay moves to a standard Replit app for managed AI; data + cutover tooling and constraints.
---

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
- Cutover order: snapshot prod right before DNS flip (messages between snapshot and flip are
  lost); old app stays intact as rollback until DNS verified.
