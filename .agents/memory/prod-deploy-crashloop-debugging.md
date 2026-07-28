---
name: Production deploy crash-loop debugging (Buzz relay)
description: How to diagnose start-replit.sh crash loops in prod, and the set -e / REPLIT_DOMAINS traps that caused one
---

The deployment build logs stop at "Creating Autoscale service" for promote-step failures; the real error is only in runtime logs (fetchDeploymentLogs), which DROP lines during fast crash loops. start-replit.sh carries an ERR trap (`FATAL start-replit.sh: rc=... line=... cmd=[...]`) that survives lossy capture — keep it, and read its line number against the *current* script (the trap block itself shifts line numbers).

**Two durable environment traps (2026-07-28 incident):**

1. In production deployments, `REPLIT_DOMAINS` includes the verified custom domain (e.g. buzz.shopstrmarkets.com); in dev it does not. Any script that merges `BUZZ_CUSTOM_DOMAINS` with `REPLIT_DOMAINS` must tolerate duplicates — code paths only reachable via duplication are prod-only and untestable in dev.
2. In bash under `set -e`, a bare `return` inside a function propagates `$?` of the previous command. The guard idiom `[[ -z "$x" ]] && return` leaves `$?=1`, so a later bare `return` (e.g. a case-match early exit) returns 1 and `set -e` kills the script. Always use explicit `return 0` on success paths in functions called as plain commands under `set -e`.

**Why:** the relay deploy crash-looped for ~1h because `_acp_add_host` hit both traps at once; the same script booted fine in dev, making it look merge-related when it was not.

**How to apply:** when a deploy fails at "Creating Autoscale service" with `command finished with error [...]: exit status 1`, go straight to fetchDeploymentLogs for the FATAL trap line; when editing bash helpers in scripts/, audit every bare `return` for `$?` propagation.
