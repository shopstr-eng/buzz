# Migrating this Buzz relay to a standard Replit App

Goal: move development + production of this relay into a **new, standard
Replit App** so it can use **Replit AI Integrations** (keyless Anthropic
access billed to Replit credits). The current workspace type cannot use
managed AI credentials; a standard app can.

Everything the new app needs to build and run travels in this git repo
(`.replit`, `replit.nix`, `scripts/`, vendored `tokio-websockets` patch).
What does NOT travel: secrets, database contents, and the custom domain.
This runbook covers those.

---

## Phase 0 — already done in the old workspace

- `scripts/start-replit.sh` now self-defaults every required env var
  (`BUZZ_BIND_ADDR=0.0.0.0:5000`, auth/membership flags, `REDIS_URL`, ...),
  so a fresh import boots correctly with **no** env-var setup.
- Data tooling committed:
  - `scripts/export-buzz-data.sh` — full dev-data tarball (pg_dump + repos/).
  - `scripts/import-buzz-data.sh` — restore that tarball (pg_restore).
  - `scripts/import-json-export.sh` — restore a JSON export (used for
    production data, where only read-only SQL access exists on the old side).
  - One-shot production seeding: if `backups/prod-seed.json` exists in the
    workspace at publish time and the deployed database has **zero channels**,
    the start script imports it automatically on first boot, then never again.
- Latest `main` pushed to GitHub (`shopstr-eng/buzz`).

## Phase 1 — create the new app

1. Replit → **Create App** → **Import from GitHub** → `shopstr-eng/buzz`.
2. Do not let Agent "set up" the project from scratch — the repo already has
   `.replit` (workflow **Buzz Relay**, VM deployment config, ports). If Agent
   proposes a different run command, keep `bash scripts/start-replit.sh`.
3. First run: the Rust build takes several minutes (release build of
   relay + acp + agent + cli). Subsequent boots reuse `target/release`.
   Note: cargo must run with `--ignore-rust-version` (already encoded in all
   scripts) because Replit's toolchain is 1.88.

## Phase 2 — copy secrets (before anyone connects!)

In the OLD app: Secrets pane → reveal values. In the NEW app: Secrets pane →
add the same keys/values:

| Secret | Why it must be identical |
| --- | --- |
| `BUZZ_RELAY_PRIVATE_KEY` | Relay identity. Owner pubkey, NIP-42 auth, and all membership checks derive from it. A new key = a different relay. |
| `BUZZ_ACP_PRIVATE_KEY` | The AI agent's identity. Channel-member rows in the data reference this pubkey. |
| `SESSION_SECRET` | Admin-panel sessions. |
| `GITHUB_TOKEN` | Optional — only for git pushes from the new workspace. |

`RELAY_OWNER_PUBKEY` does not need to be set — the start script derives it
from `BUZZ_RELAY_PRIVATE_KEY`.

## Phase 3 — keyless AI (the reason for the move)

In the NEW app, tell its Agent:

> Use Anthropic via Replit AI Integrations for this app (Replit-managed,
> no API key). The app's agent binary reads `ANTHROPIC_API_KEY`,
> `ANTHROPIC_BASE_URL` (optional override) and `ANTHROPIC_MODEL` from the
> environment — map whatever the integration injects to those names in
> `scripts/start-replit.sh` (see the existing OPENAI_API_KEY mapping there
> as the pattern).

Approve the **“Anthropic (Replit managed)”** card when it appears. Then set
the provider so the worker starts:

- `BUZZ_AGENT_PROVIDER=anthropic` and `ANTHROPIC_MODEL=claude-opus-4-5`
  (already present for production in `.replit` `[userenv.production]`; for
  dev either set them as env vars or save the provider in Admin → Settings).

Verify: workflow logs show `Loaded AI provider config` /
`BUZZ_AGENT_PROVIDER` set, and an @mention to the agent in a channel gets a
reply.

## Phase 4 — development data (optional)

Old dev DB is essentially empty (test traffic only). If wanted:

1. Old app shell: `bash scripts/export-buzz-data.sh` → download the tarball
   from `backups/`.
2. Upload into the new app and run
   `bash scripts/import-buzz-data.sh backups/<file>.tar.gz`.

## Phase 5 — production cutover

Production currently serves `buzz.shopstrmarkets.com` from the OLD app's VM
deployment and has real data (channels, members, messages).

1. **Snapshot prod data** (old side): the old app's Agent exports every
   non-empty table from the production replica to
   `backups/prod-export-<ts>.json` (read-only SQL; done in chat, no downtime).
2. **Stage the seed** (new side): place that file at
   `backups/prod-seed.json` in the NEW app's workspace (upload in chat or
   shell). It is gitignored; VM deployments snapshot the filesystem, so it
   ships in the image.
3. **Publish the new app** (VM deployment — config already in `.replit`):
   set `BUZZ_CUSTOM_DOMAINS=buzz.shopstrmarkets.com` in the new deployment's
   production env **before the first boot** — the relay is host-tenant-bound,
   and the imported data belongs to the `buzz.shopstrmarkets.com` community,
   so RELAY_URL must match from the very first start. On first boot the empty
   prod DB triggers the one-shot seed import; logs show
   `Empty relay DB and seed file present — importing`. If the import fails
   the deployment **exits on purpose** (fail-closed) rather than starting an
   empty relay — check logs, fix, redeploy.
4. **Verify before flipping DNS.** The browser UI on the temporary
   `<new-app>.replit.app` URL will NOT show the migrated channels — the relay
   resolves tenants by `Host` header, and the migrated data lives under the
   custom-domain community. Verify instead with:
   - Deployment logs: seed-import line + final row counts.
   - Host-override curls against the temp URL, e.g.
     `curl -s -H "Host: buzz.shopstrmarkets.com" -H "Accept: application/nostr+json" https://<new-app>.replit.app/`
     (NIP-11 doc should show the relay owner pubkey).
   - Optional full-UI check: point `buzz.shopstrmarkets.com` at the new
     deployment's IP in your local `/etc/hosts` and use the real domain in
     the browser before touching public DNS.
5. **Move the domain**: old app → deployment settings → remove
   `buzz.shopstrmarkets.com`; new app → add it; update the DNS A/TXT records
   at the registrar to the values the new app shows. (Expect propagation
   delay; the old deployment keeps working for anything still resolving to
   it until you tear it down.)
6. **Freeze then retire the old deployment** once DNS has flipped and the
   new relay is verified. Any messages posted to the old prod between
   snapshot (step 1) and DNS flip (step 5) are not in the new DB — do the
   snapshot right before the flip, or accept a small gap.
7. Remove `backups/prod-seed.json` from the new workspace after a successful
   cutover so a future DB wipe can't resurrect ancient data unexpectedly.

## Rollback

The old app stays fully intact until you delete it. If anything goes wrong,
point DNS back / re-add the domain to the old deployment.

## Known quirks carried in the repo

- Rust 1.88 vs `rust-toolchain.toml` 1.95: every cargo call uses
  `--ignore-rust-version`; do NOT add `/home/runner/workspace/bin` to PATH.
- `vendor/tokio-websockets/` patch (AVX-512): keep until Replit ships
  Rust ≥ 1.89.
- Redis runs in-workspace (`replit.nix`), started by the start script; it is
  cache-only (`--save ""`).
- The relay maps requests to communities by `Host` header — local `curl`
  needs `-H "Host: <domain>"`.
