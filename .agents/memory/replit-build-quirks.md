---
name: Replit build quirks for Buzz relay
description: Rust toolchain + AVX-512 + startup env var issues specific to running Buzz relay on Replit's Nix environment.
---

## Rust toolchain

The project's `rust-toolchain.toml` pins to 1.95.0 but Replit's `rust-stable` Nix module is 1.88.0. Use `--ignore-rust-version` on every `cargo` invocation. Do NOT prepend `/home/runner/workspace/bin` to PATH — the hermit shim routes through a broken rustc 1.95.0 with a TLS shared-library error (`cannot allocate memory in static TLS block`).

```bash
unset RUSTUP_TOOLCHAIN RUSTUP_HOME
export PATH=$(printf '%s' "$PATH" | tr ':' '\n' | grep -v '/home/runner/workspace/bin' | paste -sd ':')
cargo run -p buzz-relay --release --ignore-rust-version
```

## Background builds die with the shell call

`(cargo build ... &)` in a subshell gets killed when the ShellExec call ends — silently, with an empty log. Use `setsid nohup cargo build ... > /tmp/build.log 2>&1 < /dev/null &` to detach. And never poll with `pgrep -f "cargo build"` from a shell whose own command line contains that string — it matches itself and reports a dead build as running; use `pgrep -x cargo` instead. Foreground builds in repeated 5-min chunks (per the tool timeout) also work fine.

## tokio-websockets AVX-512 patch

`tokio-websockets 0.13.x` uses `#[target_feature(enable = "avx512f")]` which is an unstable Rust feature until 1.89.0. All 0.13.x versions have this issue.

**Fix:** vendor a patched copy at `vendor/tokio-websockets/` with:

- The `frame_avx512` function removed from `src/mask.rs`
- The `avx512f` detection branch removed from the `frame()` dispatcher
- `rust-version = "1.88"` in `Cargo.toml`

Wire in `Cargo.toml` workspace:

```toml
[patch.crates-io]
tokio-websockets = { path = "vendor/tokio-websockets" }
```

**Revert when:** Replit upgrades to Rust 1.89+; remove the `[patch.crates-io]` entry and delete `vendor/tokio-websockets/`.

## Required env vars for relay startup

All must be set (shared environment) for the relay to start:

| Var                             | Value / Note                                                   |
| ------------------------------- | -------------------------------------------------------------- |
| `BUZZ_BIND_ADDR`                | `0.0.0.0:3000`                                                 |
| `RELAY_URL`                     | `wss://<dev-domain>` — derived from REPLIT_DEV_DOMAIN          |
| `REDIS_URL`                     | `redis://127.0.0.1:6379`                                       |
| `BUZZ_REQUIRE_RELAY_MEMBERSHIP` | `true`                                                         |
| `BUZZ_AUTO_MIGRATE`             | `true`                                                         |
| `BUZZ_WEB_DIR`                  | `/home/runner/workspace/web/dist`                              |
| `BUZZ_ADMIN_WEB_DIR`            | `/home/runner/workspace/admin-web/dist`                        |
| `BUZZ_GIT_CONFORMANCE_PROBE`    | `false` — skips S3/MinIO probe at startup (no MinIO in Replit) |
| `BUZZ_RELAY_PRIVATE_KEY`        | **Secret** — 32-byte hex secp256k1 key                         |

`RELAY_OWNER_PUBKEY` is auto-derived at startup by `start-replit.sh` using `buzz-admin derive-pubkey` (reads `BUZZ_RELAY_PRIVATE_KEY` and prints the hex pubkey).

## buzz-admin derive-pubkey subcommand

Added to `crates/buzz-admin/src/main.rs`. Reads `BUZZ_RELAY_PRIVATE_KEY` from env and prints the corresponding hex public key. Used by `start-replit.sh` to auto-set `RELAY_OWNER_PUBKEY`.

**Why:** The relay fails closed with `RELAY_OWNER_PUBKEY required when BUZZ_REQUIRE_RELAY_MEMBERSHIP=true` if this var is missing. Deriving it at startup avoids the operator needing to manually look it up.

## Community row seeding

The relay looks up its community by the host from `RELAY_URL`. A row must exist in `communities` for this host or the relay fails to start.

**How it's done in start-replit.sh:** uses `psql "$DATABASE_URL"` to INSERT with `ON CONFLICT (lower(host)) DO NOTHING` — idempotent. The `seed-local-community.sh` script requires Python 3 which isn't installed in this Nix env.

**Community host binding:** The relay maps WebSocket connections to communities by the HTTP `Host` header. When testing locally with `curl`, always pass `-H "Host: <dev-domain>"` — `localhost:3000` returns 404 because no community is mapped to it.

## After merging upstream Rust changes

`scripts/start-replit.sh` prefers **pre-built binaries** in `target/release/` — after any merge touching `crates/` or `Cargo.lock`, rebuild all five (`buzz-relay buzz-admin buzz-agent buzz-acp buzz-dev-mcp`) or the workflow runs stale code. Release builds exceed the 5-min shell limit; re-run the same `cargo build` foreground command repeatedly — incremental progress persists between runs (detached/background processes get reaped with the shell session). Also: workflow restarts can leave a stale `buzz-relay` holding the metrics port (9102) → new instance panics `Address already in use` and crash-loops; `kill -9` the old PID first.

## Media uploads need local MinIO (provisioned by start-replit.sh)

The relay's media pipeline stores blobs in S3 (default endpoint `http://localhost:9000`); with nothing listening there, every `PUT /upload` 500s after auth passes. start-replit.sh now downloads a MinIO binary to `bin-media/` (gitignored, ~120MB), runs it on 127.0.0.1:9000 with dev creds (`buzz_dev`/`buzz_dev_secret`, data in `.minio-data/`), and creates the `buzz-media` bucket via `curl --aws-sigv4` (no `mc` needed). Setting `BUZZ_S3_ENDPOINT` to anything else skips all of this.

**Debugging ladder for uploads:** 403 = membership (signer must be a relay member of the community bound to the request Host); 422 "invalid image data" = the relay fully decodes images — bad chunk CRCs or hand-crafted payloads fail even if `file` says the image is valid; 500 = S3/storage. A live check exists at `web/src/shared/lib/__tests__/blossom-upload.e2e.test.ts` (skipped unless `E2E_RELAY_URL` + `E2E_UPLOAD_SECKEY` are set; relay owner key qualifies as member). Node `fetch` silently drops a custom `Host` header — test through `https://$REPLIT_DEV_DOMAIN`, not loopback.

## startup script order

`scripts/start-replit.sh` must:

1. Start Redis
2. Run migrations (`buzz-admin --ignore-rust-version -- migrate`)
3. Seed community row (psql)
4. Derive `RELAY_OWNER_PUBKEY` (`buzz-admin --ignore-rust-version -q -- derive-pubkey`)
5. Start relay (`buzz-relay --release --ignore-rust-version`)

## Stale workflow generations crash-loop the relay (fixed in start script)
A workflow restart can orphan an older copy of start-replit.sh whose relay still holds ports 5000/8080/9102. The new relay then panics at `metrics.rs` ("Address already in use") and the restart loop churns ~1/s while the stale relay keeps serving old code — you get multiple ACP generations and confusingly stale behavior.

**Why:** happened 2026-07-28; the serving relay was a zombie from a previous generation while the current one panic-looped on the metrics port.
**How to apply:** if logs show the metrics EADDRINUSE panic, check for multiple `target/release/buzz-relay` processes with different parent shells and kill the stale generation. start-replit.sh now pkills both binaries at startup, so recurrence means the guard was removed.

## Standard-app containers reserve 127.0.0.1:8080 (health port moved to 18081)

In the standard Replit app (post-migration, July 2026), the platform itself holds 127.0.0.1:8080 — the relay's default health port — so every boot died with `Failed to bind health port 8080: Address already in use` and the workflow timed out on waitForPort 5000. Fixed by defaulting `BUZZ_HEALTH_PORT=18081` in start-replit.sh and remapping `.replit` [[ports]] to localPort 18081 → external 8080.

**Why:** the old workspace type did not reserve 8080; the standard app does (visible in `/proc/net/tcp` even with zero user processes).
**How to apply:** never bind any Buzz component to 8080 in this app; probe a candidate port before assigning it.

Related tooling traps in this environment:
- `ss -tlnp` shows NOTHING here (not even live listeners) — probe with `(exec 3<>/dev/tcp/127.0.0.1/PORT)` or read `/proc/net/tcp` (state 0A = LISTEN, hex ports).
- `pkill -f <pattern>` from a shell command kills the shell itself when the pattern appears in its own command line (e.g. `pkill -f 'target/release/buzz'`); use a non-self-matching pattern like `'release/buzz[-]relay'`.
- `.replit` edits go through the verifyAndReplaceDotReplit temp-file flow, and the platform re-normalizes the [[ports]] section afterwards (it resurrected a stale 8080→8080 mapping and reassigned external ports) — always `cat .replit` after applying to confirm what actually landed.
