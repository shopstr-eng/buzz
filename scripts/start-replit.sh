#!/usr/bin/env bash
# Start script for Replit deployment.
# Starts Redis in the background, then runs the Buzz relay.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

# Use the Nix-managed Rust toolchain (rust-stable module, 1.88.0).
# We pass --ignore-rust-version to cargo so that crates declaring >=1.91/1.94
# minimum versions don't block the build; the code compiles fine on 1.88.
# Do NOT prepend /home/runner/workspace/bin — that activates the hermit cargo
# shim which routes through a broken rustc 1.95.0 (TLS shared-library issue).
unset RUSTUP_TOOLCHAIN RUSTUP_HOME # prevent rustup from intercepting cargo calls
# Strip hermit workspace/bin from PATH so the Nix cargo 1.88 is used, not the
# hermit rustup shim (which routes to a broken rustc 1.95.0 in this container).
export PATH=$(printf '%s' "$PATH" | tr ':' '\n' | grep -v '/home/runner/workspace/bin' | paste -sd ':')

# Disable git object-store conformance probe (requires S3 which isn't configured).
export BUZZ_GIT_CONFORMANCE_PROBE="${BUZZ_GIT_CONFORMANCE_PROBE:-false}"

# ---------------------------------------------------------------------------
# 1. Start Redis (background)
# ---------------------------------------------------------------------------
if ! redis-cli ping >/dev/null 2>&1; then
  echo "==> Starting Redis..."
  redis-server --daemonize yes --loglevel warning --save "" --bind 127.0.0.1 --port 6379
  sleep 1
  if redis-cli ping >/dev/null 2>&1; then
    echo "==> Redis started."
  else
    echo "ERROR: Redis failed to start." >&2
    exit 1
  fi
else
  echo "==> Redis already running."
fi

# ---------------------------------------------------------------------------
# 2. Run migrations (idempotent — safe to run on every restart)
# ---------------------------------------------------------------------------
echo "==> Running database migrations..."
cargo run -p buzz-admin --ignore-rust-version -- migrate

# ---------------------------------------------------------------------------
# 3. Seed community row from RELAY_URL (idempotent)
# ---------------------------------------------------------------------------
echo "==> Seeding community row (idempotent)..."
# seed-local-community.sh requires python3 which isn't available in this env;
# we seed directly via psql using the host derived from RELAY_URL.
if command -v psql >/dev/null 2>&1 && [[ -n "${RELAY_URL:-}" ]]; then
  RELAY_HOST=$(echo "$RELAY_URL" | sed -E 's#wss?://([^/:]+)(:[0-9]+)?.*#\1#')
  psql "$DATABASE_URL" -c \
    "INSERT INTO communities (host) VALUES ('${RELAY_HOST}') ON CONFLICT (lower(host)) DO NOTHING;" \
    2>/dev/null && echo "==> Community row seeded (host=${RELAY_HOST})." \
    || echo "==> Community seed skipped (already exists or psql unavailable)."
fi

# ---------------------------------------------------------------------------
# 4. Derive RELAY_OWNER_PUBKEY from BUZZ_RELAY_PRIVATE_KEY (if not already set)
# ---------------------------------------------------------------------------
if [[ -z "${RELAY_OWNER_PUBKEY:-}" ]] && [[ -n "${BUZZ_RELAY_PRIVATE_KEY:-}" ]]; then
  echo "==> Deriving RELAY_OWNER_PUBKEY from BUZZ_RELAY_PRIVATE_KEY..."
  RELAY_OWNER_PUBKEY=$(cargo run -p buzz-admin --ignore-rust-version -q -- derive-pubkey 2>/dev/null)
  if [[ -n "$RELAY_OWNER_PUBKEY" ]]; then
    export RELAY_OWNER_PUBKEY
    echo "==> RELAY_OWNER_PUBKEY=${RELAY_OWNER_PUBKEY}"
  else
    echo "==> Warning: could not derive RELAY_OWNER_PUBKEY — relay may refuse to start." >&2
  fi
fi

# ---------------------------------------------------------------------------
# 5. Start the relay
# ---------------------------------------------------------------------------
export BUZZ_BIND_ADDR="${BUZZ_BIND_ADDR:-0.0.0.0:3000}"
export REDIS_URL="${REDIS_URL:-redis://127.0.0.1:6379}"

if [[ -d web/dist ]]; then
  export BUZZ_WEB_DIR="$(pwd)/web/dist"
  # Enable full workspace UI at / (not just the invite landing page)
  export BUZZ_SERVE_GIT_WEB_GUI="${BUZZ_SERVE_GIT_WEB_GUI:-true}"
  echo "==> Serving web UI from web/dist (BUZZ_SERVE_GIT_WEB_GUI=${BUZZ_SERVE_GIT_WEB_GUI})"
else
  echo "==> Warning: web/dist not found — run 'cd web && npm install && npm run build' to enable web UI"
fi

if [[ -d admin-web/dist ]]; then
  export BUZZ_ADMIN_WEB_DIR="$(pwd)/admin-web/dist"
  if [[ -n "${BUZZ_ADMIN_HOST:-}" ]]; then
    echo "==> Serving admin UI from admin-web/dist (host-based: ${BUZZ_ADMIN_HOST})"
  else
    echo "==> Serving admin UI from admin-web/dist (path-based: /admin/)"
  fi
else
  echo "==> Warning: admin-web/dist not found — run 'cd admin-web && npm install && npm run build' to enable admin UI"
fi

echo "==> Starting Buzz relay on ${BUZZ_BIND_ADDR}..."

exec cargo run -p buzz-relay --release --ignore-rust-version
