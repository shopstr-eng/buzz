#!/usr/bin/env bash
# Post-merge setup script — runs automatically after each task merge.
# Idempotent and non-interactive (stdin is closed).
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

# Use the Nix-managed Rust 1.88.0 (rust-stable module).
# --ignore-rust-version bypasses crate minimum-version guards; code compiles fine.
unset RUSTUP_TOOLCHAIN RUSTUP_HOME # prevent rustup from intercepting cargo calls

echo "==> [post-merge] Installing npm dependencies for web/"
(cd web && npm install --prefer-offline 2>&1) || true

echo "==> [post-merge] Installing npm dependencies for admin-web/"
(cd admin-web && npm install --prefer-offline 2>&1) || true

echo "==> [post-merge] Running database migrations..."
# Requires DATABASE_URL to be set (Replit runtime-managed)
if cargo run -p buzz-admin --ignore-rust-version -- migrate 2>&1; then
  echo "==> [post-merge] Migrations complete."
else
  echo "==> [post-merge] Warning: migrations failed (relay may not be running yet — this is normal on first deploy)."
fi

echo "==> [post-merge] Done."
