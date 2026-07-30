---
name: PromptChannelInfo model field
description: Upstream block/buzz dropped `model` from PromptChannelInfo; this fork's per-channel model feature re-adds it. Re-verify after every upstream merge.
---

## Rule

Upstream (block/buzz) removed the `model` field from `PromptChannelInfo` (crates/buzz-acp/src/queue.rs). This fork's per-channel model feature re-adds it (`pub model: Option<String>` from the channel's kind:39000 `model` tag) and consumes it in `crates/buzz-acp/src/pool.rs` (sets `agent.desired_model` when creating a channel session, gated on `!agent.model_overridden`).

**Why:** Upstream and this fork diverged on per-channel model selection. Each upstream merge risks silently dropping the field or the pool.rs application block, which breaks per-channel models without a compile error in the UI layers.

**How to apply:** After every `git merge upstream/main`, grep `struct PromptChannelInfo` for the `model` field and check pool.rs still applies `ci.model` into `agent.desired_model`. Upstream tends to refactor the exact session-creation block where our application code lives, so prefer union merges there over taking either side wholesale.

## Other fork-only relay APIs that upstream merges clobber

When resolving conflicts in `crates/buzz-relay/src/api/invites.rs` by taking upstream's version, two fork-only endpoints disappear and must be re-added:

- `GET /api/me/membership` (`membership_status`) — web LoginPage + desktop OnboardingFlow depend on it for login-time membership checks.
- The admin-panel invite mint (`mint_invite_admin` in api/admin/mod.rs) — admin-web posts `{ttlSecs, singleUse}`; rewire to upstream's v2 `db.mint_relay_invite` with `single_use → max_uses=1`.

**Why:** compile fails loudly for missing routes (route registration references the handler), but only for the exact symbols the router names — a clean-looking conflict resolution can still silently drop fork behavior.

## Replaced migrations break applied databases

When an upstream merge *replaces* an already-applied migration file (add/add conflict on `migrations/NNNN_*.sql`), the dev/prod DB fails startup with "migration N was previously applied but has been modified".

**How to apply (dev):** `DROP TABLE` the old table, `DELETE FROM _sqlx_migrations WHERE version = N;`, re-run `buzz-admin migrate`. Happened with 0025_relay_invites (fork's v1 single-use table vs upstream's v2 use-limited table; v2 supersedes, old table was empty).

**Version-collision variant (2026-07-30 merge):** upstream added `0026_replica_heartbeat.sql` while the fork's `0026_channel_model.sql` was already applied as version 26 in dev+prod — no add/add conflict, but the same "previously applied but has been modified" startup failure. Fix: renumber UPSTREAM's file to 0027 (never renumber the one already applied in DBs), then update hardcoded version/count assertions in `crates/buzz-db/src/migration.rs` tests and "migration 0026" references in `replica_fence.rs`.

**Migrations are compile-time embedded** (`sqlx::migrate!` in `crates/buzz-db/src/migration.rs`) — after ANY migration add/rename, `cargo build` the relay/admin binaries BEFORE restarting the workflow, or the old binary re-fails on the old embedded set.

## Environment traps (2026-07-28 merge)

- **Git identity is not configured in this repl** — `git merge upstream/main` fails with "unable to auto-detect email address". Set repo-local identity first (`git config user.name/user.email`).
- **start-replit.sh builds Rust binaries only-if-missing** — after an upstream merge that touches `crates/`, the running relay/ACP keeps the STALE binary across restarts. Force `cargo build -p <changed-pkg> --release --ignore-rust-version`, then restart the workflow.

**Why:** both produce silent staleness — the merge "succeeds" but the deployed behavior doesn't change.
