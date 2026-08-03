---
name: DB pool sizing on Replit prod (autoscale + managed Postgres)
description: Why prod hit "pool timed out while waiting for an open connection" and the sizing/timeout rules that prevent it.
---

## Rule
Keep the *per-pod* Postgres footprint small and the acquire timeout generous on Replit's
managed Postgres:
- Writer pool default is 20 (`BUZZ_DB_POOL_SIZE`), audit pool 5, search pool capped at 5
  (min 0). Total ≈30 server connections per pod.
- Acquire timeout default is 10s (`BUZZ_DB_ACQUIRE_TIMEOUT_SECS`), not sqlx-ish 3s.

**Why:** The prod deployment is *autoscale* — N pods multiply every pool. With the old
writer default of 50 (+5 audit +10 uncapped search), two pods could demand ~130 server
connections, blowing the managed-Postgres server cap; refused dials surface as sqlx
"pool timed out while waiting for an open connection". Separately, Neon-style computes
suspend when idle and the pool shrinks to min_connections, so the first acquire after a
quiet period pays TLS+auth+compute-resume — routinely >3s. That is why the errors hit
exactly the periodic background jobs (push matcher/wake claims, reminder scheduler,
usage metrics, NIP-43 reconciliation): they fire when traffic is idle and silently skip
their tick on error.

**How to apply:** When adding a new sqlx pool anywhere in the relay, always set
max_connections, min_connections, and acquire_timeout explicitly, and budget it against
`pods × (writer + audit + search + new)` vs the server cap. Raise BUZZ_DB_POOL_SIZE only
on databases with real headroom (Aurora-class). Diagnosis is code + deployment logs;
prod DB is read-only from tools and deployment logs age out quickly (they were already
gone a day after the incident).

## Related trap
`cargo test -p buzz-relay` cannot build in this workspace since the 2026-07-31 upstream
merge: dev-dependency mesh-llm → hf-hub → xet-client → redb requires rustc ≥1.89 vs the
environment's 1.88. Validate relay changes with `cargo check` + release build instead.
