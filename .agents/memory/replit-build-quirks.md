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

## startup script order

`scripts/start-replit.sh` must:

1. Start Redis
2. Run migrations (`buzz-admin --ignore-rust-version -- migrate`)
3. Seed community row (psql)
4. Derive `RELAY_OWNER_PUBKEY` (`buzz-admin --ignore-rust-version -q -- derive-pubkey`)
5. Start relay (`buzz-relay --release --ignore-rust-version`)
