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
# Both REPLIT_DEV_DOMAIN and REPLIT_DOMAINS can be set in a production VM —
# check REPLIT_DOMAINS first so production always seeds the real public domain
# (e.g. buzzstr.replit.app) rather than the ephemeral janeway preview URL.
if [[ -n "${BUZZ_CUSTOM_DOMAINS:-}" ]]; then
  # Prefer the operator-configured canonical domain (e.g. buzz.shopstrmarkets.com)
  # over Replit's generated domain.  This ensures invite URLs, RELAY_URL in NIP-11,
  # and any other self-referential links use the public-facing hostname.
  # BUZZ_CUSTOM_DOMAINS is comma-separated; take the first entry.
  CANONICAL_DOMAIN="$(echo "${BUZZ_CUSTOM_DOMAINS}" | cut -d',' -f1 | tr -d ' ')"
  export RELAY_URL="wss://${CANONICAL_DOMAIN}"
  export BUZZ_MEDIA_BASE_URL="https://${CANONICAL_DOMAIN}/media"
elif [[ -n "${REPLIT_DOMAINS:-}" ]]; then
  # REPLIT_DOMAINS may be comma-separated; take the first entry.
  PRIMARY_DOMAIN="$(echo "${REPLIT_DOMAINS}" | cut -d',' -f1 | tr -d ' ')"
  export RELAY_URL="wss://${PRIMARY_DOMAIN}"
  export BUZZ_MEDIA_BASE_URL="https://${PRIMARY_DOMAIN}/media"
elif [[ -n "${REPLIT_DEV_DOMAIN:-}" ]]; then
  export RELAY_URL="wss://${REPLIT_DEV_DOMAIN}"
  export BUZZ_MEDIA_BASE_URL="https://${REPLIT_DEV_DOMAIN}/media"
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

# Build buzz-acp and buzz-agent if missing (they are pre-built in the
# deployment image by prepare-deploy.sh; this path covers dev restarts).
build_rust_bin_if_missing() {
  local bin="$1"
  local pkg="$2"
  local binary_path="${REPO_ROOT}/target/release/${bin}"
  if [[ ! -x "$binary_path" ]]; then
    echo "==> Pre-built ${bin} not found — building now (this may take a few minutes)..."
    cargo build -p "$pkg" --release --ignore-rust-version 2>&1
    echo "==> ${bin} build complete."
  fi
}
build_rust_bin_if_missing buzz-acp   buzz-acp
build_rust_bin_if_missing buzz-agent buzz-agent

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

  # Seed any additional custom domains (e.g. a custom domain pointed at the relay).
  # Set BUZZ_CUSTOM_DOMAINS to a comma-separated list of hostnames in the production
  # environment secrets — they will be inserted here on every startup (idempotent).
  if [[ -n "${BUZZ_CUSTOM_DOMAINS:-}" ]]; then
    IFS=',' read -ra CUSTOM_HOSTS <<< "$BUZZ_CUSTOM_DOMAINS"
    for CUSTOM_HOST in "${CUSTOM_HOSTS[@]}"; do
      CUSTOM_HOST="$(echo "$CUSTOM_HOST" | tr -d ' ')"
      [[ -z "$CUSTOM_HOST" ]] && continue
      psql "$DATABASE_URL" -c \
        "INSERT INTO communities (host) VALUES ('${CUSTOM_HOST}') ON CONFLICT (lower(host)) DO NOTHING;" \
        2>/dev/null && echo "==> Custom domain seeded (host=${CUSTOM_HOST})." \
        || echo "==> Custom domain seed skipped (already exists or error): ${CUSTOM_HOST}"
    done
  fi
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
# 5b. Resolve the ACP worker keypair and pre-register it as a relay member.
#
#     Priority:
#       1. BUZZ_ACP_PRIVATE_KEY secret (stable identity across restarts)
#       2. Ephemeral key generated fresh each boot (functional but pubkey
#          changes on every restart — fine for dev, use the secret in prod)
# ---------------------------------------------------------------------------
ACP_PRIVATE_KEY="${BUZZ_ACP_PRIVATE_KEY:-}"
ACP_PUBKEY=""

if [[ -z "$ACP_PRIVATE_KEY" ]]; then
  echo "==> No BUZZ_ACP_PRIVATE_KEY set — generating ephemeral ACP keypair..."
  _ACP_KEY_OUTPUT=$(run_bin buzz-admin buzz-admin generate-key 2>/dev/null || true)
  ACP_PRIVATE_KEY=$(echo "$_ACP_KEY_OUTPUT" | awk '/^Secret key:/{print $3}')
  if [[ -n "$ACP_PRIVATE_KEY" ]]; then
    echo "==> Ephemeral ACP keypair generated."
  else
    echo "==> Warning: could not generate ACP keypair — ACP workers will not start." >&2
  fi
else
  echo "==> Using BUZZ_ACP_PRIVATE_KEY for ACP worker."
fi

if [[ -n "$ACP_PRIVATE_KEY" ]]; then
  # Derive the ACP pubkey by temporarily supplying the ACP key as BUZZ_RELAY_PRIVATE_KEY
  # (buzz-admin derive-pubkey reads that env var).
  ACP_PUBKEY=$(BUZZ_RELAY_PRIVATE_KEY="$ACP_PRIVATE_KEY" \
               run_bin buzz-admin buzz-admin derive-pubkey 2>/dev/null || true)
  if [[ -n "$ACP_PUBKEY" ]]; then
    echo "==> ACP worker pubkey: ${ACP_PUBKEY}"
    # Register in the localhost community (127.0.0.1:<port>) — this is the community
    # the ACP worker authenticates against when connecting via ws://127.0.0.1:<port>.
    # buzz-admin resolves community from RELAY_URL, so we override it to the localhost URL.
    _BIND_PORT=$(echo "${BUZZ_BIND_ADDR:-0.0.0.0:5000}" | cut -d: -f2)
    RELAY_URL="ws://127.0.0.1:${_BIND_PORT}" \
      run_bin buzz-admin buzz-admin add-member --pubkey "$ACP_PUBKEY" >/dev/null 2>&1 \
      && echo "==> ACP worker registered as relay member (community: 127.0.0.1:${_BIND_PORT})." \
      || echo "==> ACP worker member registration skipped (already exists or error)."
  else
    echo "==> Warning: could not derive ACP pubkey — skipping member registration." >&2
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
ACP_BIN="${REPO_ROOT}/target/release/buzz-acp"
RELAY_PID=""
ACP_PID=""
STOPPING=false

# When the workflow is stopped, kill the watcher, relay, and ACP worker cleanly.
_cleanup() {
  STOPPING=true
  [[ -n "$RELAY_PID" ]] && kill -TERM "$RELAY_PID" 2>/dev/null || true
  [[ -n "$ACP_PID"   ]] && kill -TERM "$ACP_PID"   2>/dev/null || true
  [[ -n "$WATCHER_PID" ]] && kill -TERM "$WATCHER_PID" 2>/dev/null || true
  rm -f /tmp/buzz-relay.pid /tmp/buzz-acp.pid
}
trap '_cleanup' SIGTERM SIGINT

# ---------------------------------------------------------------------------
# 9. Start the ACP worker in background (if we have a keypair).
#    It connects to the local relay at ws://localhost:<port> and manages
#    AI agent subprocesses (buzz-agent by default, or BUZZ_ACP_AGENT_COMMAND).
#    The worker auto-reconnects when the relay restarts; no explicit retry loop
#    needed here — buzz-acp has built-in reconnect logic.
# ---------------------------------------------------------------------------
_start_acp() {
  [[ -z "$ACP_PRIVATE_KEY" ]] && return
  [[ ! -x "$ACP_BIN" ]] && { echo "==> Warning: buzz-acp binary not found — ACP workers disabled." >&2; return; }

  local bind_port
  bind_port=$(echo "${BUZZ_BIND_ADDR:-0.0.0.0:5000}" | cut -d: -f2)
  local acp_relay_url="ws://127.0.0.1:${bind_port}"

  echo "==> Starting ACP worker (relay=${acp_relay_url}, owner=${RELAY_OWNER_PUBKEY:-<none>})..."

  # Pass the ACP key as BUZZ_PRIVATE_KEY (what buzz-acp reads).
  # BUZZ_ACP_AGENT_COMMAND defaults to buzz-agent (the self-contained LLM agent).
  # Operators can override via BUZZ_ACP_AGENT_COMMAND / BUZZ_ACP_AGENT_ARGS secrets.
  # The relay expects the auth URL to use the same scheme as its own RELAY_URL
  # (wss:// for production, ws:// for plain-text dev).  ACP connects via plain
  # ws:// on loopback, so we tell it to sign auth events with the wss:// form.
  local relay_scheme
  relay_scheme=$(echo "${RELAY_URL:-ws://localhost:5000}" | cut -d: -f1)

  # Derive the HTTP scheme the relay expects for NIP-98 (wss→https, ws→http).
  local http_scheme
  [[ "$relay_scheme" == "wss" ]] && http_scheme="https" || http_scheme="http"

  BUZZ_PRIVATE_KEY="$ACP_PRIVATE_KEY" \
  BUZZ_RELAY_URL="$acp_relay_url" \
  BUZZ_ACP_NIP42_RELAY_URL="${relay_scheme}://127.0.0.1:${bind_port}" \
  BUZZ_ACP_NIP98_BASE_URL="${http_scheme}://127.0.0.1:${bind_port}" \
  BUZZ_ACP_AGENT_OWNER="${RELAY_OWNER_PUBKEY:-}" \
  BUZZ_ACP_AGENT_COMMAND="${BUZZ_ACP_AGENT_COMMAND:-${REPO_ROOT}/target/release/buzz-agent}" \
  BUZZ_ACP_AGENT_ARGS="${BUZZ_ACP_AGENT_ARGS:-acp}" \
  BUZZ_ACP_SUBSCRIBE="${BUZZ_ACP_SUBSCRIBE:-mentions}" \
  BUZZ_ACP_LAZY_POOL="${BUZZ_ACP_LAZY_POOL:-true}" \
  "$ACP_BIN" >>/tmp/buzz-acp.log 2>&1 &

  ACP_PID=$!
  echo $ACP_PID > /tmp/buzz-acp.pid
  echo "==> ACP worker started (PID ${ACP_PID})."
}

# Wait for the relay port to be ready before starting ACP.
# Wait for the relay port to be ready before starting ACP.
_wait_for_relay() {
  local port
  port=$(echo "${BUZZ_BIND_ADDR:-0.0.0.0:5000}" | cut -d: -f2)
  local tries=0
  while true; do
    bash -c "echo > /dev/tcp/127.0.0.1/${port}" 2>/dev/null
    local rc=$?
    [[ $rc -eq 0 ]] && return 0
    sleep 0.5
    tries=$((tries + 1))
    [[ $tries -ge 60 ]] && { echo "==> Warning: relay did not open port ${port} in 30s." >&2; return 1; }
  done
}

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

  # Kill any previous ACP worker before starting a fresh one.
  if [[ -n "$ACP_PID" ]]; then
    kill -TERM "$ACP_PID" 2>/dev/null || true
    wait "$ACP_PID" 2>/dev/null || true
    ACP_PID=""
  fi

  # Wait for the relay port inline so ACP_PID is set in this shell (not a subshell).
  # _wait_for_relay has a 10-second cap so the loop is not blocked indefinitely.
  # Wait for the relay port inline so ACP_PID is set in this shell (not a subshell).
  # _wait_for_relay has a 30-second cap so the loop is not blocked indefinitely.
  if _wait_for_relay; then
    _start_acp
  fi

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

# Clean up watcher and ACP if still running
[[ -n "$WATCHER_PID"  ]] && kill -TERM "$WATCHER_PID"  2>/dev/null || true
[[ -n "$ACP_PID"      ]] && kill -TERM "$ACP_PID"      2>/dev/null || true
