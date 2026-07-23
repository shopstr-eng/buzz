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

# Derive RELAY_URL from the current domain so the community row is seeded for
# the host the Replit proxy actually sends in the Host header.
# In dev: REPLIT_DEV_DOMAIN is set (*.janeway.replit.dev).
# In prod: REPLIT_DOMAINS is set (*.replit.app or custom domain), REPLIT_DEV_DOMAIN is not.
if [[ -n "${REPLIT_DEV_DOMAIN:-}" ]]; then
  export RELAY_URL="wss://${REPLIT_DEV_DOMAIN}"
  export BUZZ_MEDIA_BASE_URL="https://${REPLIT_DEV_DOMAIN}/media"
elif [[ -n "${REPLIT_DOMAINS:-}" ]]; then
  # REPLIT_DOMAINS may be comma-separated; take the first entry.
  PRIMARY_DOMAIN="$(echo "${REPLIT_DOMAINS}" | cut -d',' -f1 | tr -d ' ')"
  export RELAY_URL="wss://${PRIMARY_DOMAIN}"
  export BUZZ_MEDIA_BASE_URL="https://${PRIMARY_DOMAIN}/media"
fi

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
# Helper: resolve a pre-built binary or fall back to cargo run
# Usage: run_bin <binary-name> <cargo-package> [args...]
# ---------------------------------------------------------------------------
REPO_ROOT="$(pwd)"
run_bin() {
  local bin="$1"; shift
  local pkg="$1"; shift
  local binary_path="${REPO_ROOT}/target/release/${bin}"
  if [[ -x "$binary_path" ]]; then
    "$binary_path" "$@"
  else
    echo "==> Pre-built ${bin} not found; falling back to cargo run (slow)." >&2
    cargo run -p "$pkg" --ignore-rust-version -- "$@"
  fi
}

# ---------------------------------------------------------------------------
# 2. Build web UIs (only when source files are newer than the dist output)
# ---------------------------------------------------------------------------
build_ui_if_stale() {
  local dir="$1"
  local name="$2"
  local dist="${dir}/dist/index.html"

  # Check staleness FIRST — skip everything (including npm install) when dist
  # is already up to date. This keeps production boot fast when the build step
  # pre-built the UIs and baked them into the image.
  local stale=false
  if [[ ! -f "$dist" ]]; then
    stale=true
  else
    # Check src/, index.html, vite.config*, tsconfig*, postcss.config*
    if find "${dir}" \
        \( -path "${dir}/node_modules" -prune \) -o \
        \( -path "${dir}/dist" -prune \) -o \
        \( \( -name '*.ts' -o -name '*.tsx' -o -name '*.css' \
              -o -name '*.html' -o -name '*.js' -o -name '*.mjs' \
              -o -name 'vite.config*' -o -name 'tsconfig*' \
              -o -name 'postcss.config*' -o -name 'tailwind.config*' \) \
           -newer "$dist" -print -quit \) \
        2>/dev/null | grep -q .; then
      stale=true
    fi
  fi

  if [[ "$stale" == true ]]; then
    # Only install node_modules when we actually need to rebuild.
    if [[ ! -d "${dir}/node_modules" ]]; then
      echo "==> Installing ${name} dependencies..."
      (cd "${dir}" && npm install --prefer-offline)
    fi
    echo "==> Building ${name}..."
    (cd "${dir}" && npm run build)
    echo "==> ${name} build complete."
  else
    echo "==> ${name} is up to date, skipping build."
  fi
}

build_ui_if_stale "web" "web UI"
build_ui_if_stale "admin-web" "admin UI"

# ---------------------------------------------------------------------------
# 3. Run migrations (idempotent — safe to run on every restart)
# ---------------------------------------------------------------------------
echo "==> Running database migrations..."
run_bin buzz-admin buzz-admin migrate

# ---------------------------------------------------------------------------
# 4. Seed community row from RELAY_URL (idempotent)
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

  # Also seed localhost aliases so the Replit internal preview (127.0.0.1:5000)
  # and local curl/screenshot tools can reach the relay without a community error.
  BIND_PORT=$(echo "${BUZZ_BIND_ADDR:-0.0.0.0:5000}" | cut -d: -f2)
  for LOCAL_HOST in "127.0.0.1:${BIND_PORT}" "localhost:${BIND_PORT}" "localhost"; do
    psql "$DATABASE_URL" -c \
      "INSERT INTO communities (host) VALUES ('${LOCAL_HOST}') ON CONFLICT (lower(host)) DO NOTHING;" \
      2>/dev/null || true
  done
  echo "==> Localhost aliases seeded."
fi

# ---------------------------------------------------------------------------
# 5. Derive RELAY_OWNER_PUBKEY from BUZZ_RELAY_PRIVATE_KEY (if not already set)
# ---------------------------------------------------------------------------
if [[ -z "${RELAY_OWNER_PUBKEY:-}" ]] && [[ -n "${BUZZ_RELAY_PRIVATE_KEY:-}" ]]; then
  echo "==> Deriving RELAY_OWNER_PUBKEY from BUZZ_RELAY_PRIVATE_KEY..."
  RELAY_OWNER_PUBKEY=$(run_bin buzz-admin buzz-admin derive-pubkey 2>/dev/null)
  if [[ -n "$RELAY_OWNER_PUBKEY" ]]; then
    export RELAY_OWNER_PUBKEY
    echo "==> RELAY_OWNER_PUBKEY=${RELAY_OWNER_PUBKEY}"
  else
    echo "==> Warning: could not derive RELAY_OWNER_PUBKEY — relay may refuse to start." >&2
  fi
fi

# ---------------------------------------------------------------------------
# 6. Start the relay
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

# ---------------------------------------------------------------------------
# 7. Start the Rust file-watcher in the background.
#    It rebuilds buzz-relay + buzz-admin whenever .rs/.toml files change under
#    crates/ and then SIGTERMs the relay so the loop below restarts it with
#    the new binary.
# ---------------------------------------------------------------------------
WATCHER_SCRIPT="${REPO_ROOT}/scripts/watch-rust.sh"
if [[ -f "$WATCHER_SCRIPT" ]]; then
  chmod +x "$WATCHER_SCRIPT"
  bash "$WATCHER_SCRIPT" &
  WATCHER_PID=$!
  echo "==> Rust file-watcher started (PID ${WATCHER_PID})."
else
  echo "==> Warning: watch-rust.sh not found — auto-rebuild disabled." >&2
  WATCHER_PID=""
fi

# ---------------------------------------------------------------------------
# 8. Run the relay in a restart loop.
#    The watcher SIGTERMs the relay after a successful build; the loop picks
#    up the new binary automatically.  A SIGTERM/SIGINT to this process
#    (Replit stopping the workflow) propagates cleanly.
# ---------------------------------------------------------------------------
RELAY_BIN="${REPO_ROOT}/target/release/buzz-relay"
RELAY_PID=""
STOPPING=false

# When the workflow is stopped, kill the watcher and relay cleanly.
_cleanup() {
  STOPPING=true
  [[ -n "$RELAY_PID" ]] && kill -TERM "$RELAY_PID" 2>/dev/null || true
  [[ -n "$WATCHER_PID" ]] && kill -TERM "$WATCHER_PID" 2>/dev/null || true
  rm -f /tmp/buzz-relay.pid
}
trap '_cleanup' SIGTERM SIGINT

while true; do
  if [[ -x "$RELAY_BIN" ]]; then
    echo "==> Using pre-built binary: ${RELAY_BIN}"
    "$RELAY_BIN" &
  else
    echo "==> Pre-built buzz-relay not found; falling back to cargo run (slow)." >&2
    echo "==> To pre-build: cargo build --ignore-rust-version -p buzz-relay --release" >&2
    cargo run -p buzz-relay --release --ignore-rust-version &
  fi
  RELAY_PID=$!
  echo $RELAY_PID > /tmp/buzz-relay.pid

  # Wait for the relay to exit (normal exit, crash, or SIGTERM from watcher)
  wait "$RELAY_PID" || true

  if [[ "$STOPPING" == true ]]; then
    echo "==> Relay stopped cleanly."
    break
  fi

  echo "==> Relay exited — restarting with updated binary..."
  sleep 1
  # Re-resolve binary path in case the watcher rebuilt it
  RELAY_BIN="${REPO_ROOT}/target/release/buzz-relay"
done

# Clean up watcher if still running
[[ -n "$WATCHER_PID" ]] && kill -TERM "$WATCHER_PID" 2>/dev/null || true
