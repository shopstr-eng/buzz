#!/usr/bin/env bash
# Start script for Replit deployment.
# Starts Redis in the background, then runs the Buzz relay.
set -euo pipefail

# Report the exact failing line/command on any unhandled error. Production
# crash-loop logs drop lines, so this trap is the reliable way to see where
# startup dies in the deployment container.
trap 'rc=$?; echo "==> FATAL start-replit.sh: rc=${rc} line=${LINENO} cmd=[${BASH_COMMAND}]" >&2' ERR

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

# Kill stale processes from previous workflow generations. A workflow restart
# can orphan an older copy of this script whose relay still holds ports
# 5000/8080/9102 — the new relay then panics on the metrics port (EADDRINUSE)
# and the restart loop churns while the stale relay keeps serving old code.
pkill -f 'target/release/buzz-relay' 2>/dev/null || true
pkill -f 'target/release/buzz-acp' 2>/dev/null || true
sleep 1

# Disable git object-store conformance probe (requires S3 which isn't configured).
export BUZZ_GIT_CONFORMANCE_PROBE="${BUZZ_GIT_CONFORMANCE_PROBE:-false}"

# Replit-appropriate defaults. A fresh GitHub import into a new Replit app may
# not carry this workspace's env vars, so default them here to keep behavior
# identical. Any value set in the environment still wins.
export BUZZ_BIND_ADDR="${BUZZ_BIND_ADDR:-0.0.0.0:5000}"
export BUZZ_REQUIRE_AUTH_TOKEN="${BUZZ_REQUIRE_AUTH_TOKEN:-true}"
export BUZZ_REQUIRE_RELAY_MEMBERSHIP="${BUZZ_REQUIRE_RELAY_MEMBERSHIP:-true}"
export BUZZ_SERVE_GIT_WEB_GUI="${BUZZ_SERVE_GIT_WEB_GUI:-true}"
export BUZZ_AUTO_MIGRATE="${BUZZ_AUTO_MIGRATE:-false}"
# Run channel reconciliation at startup: emits missing discovery events and
# backfills ACP agent membership after seeds/restores (see side_effects.rs).
export BUZZ_RECONCILE_CHANNELS="${BUZZ_RECONCILE_CHANNELS:-true}"
export RUST_LOG="${RUST_LOG:-buzz_relay=info,buzz_db=info,tower_http=warn}"
export REDIS_URL="${REDIS_URL:-redis://127.0.0.1:6379}"
# Standard Replit app containers reserve 127.0.0.1:8080 for a platform service
# (the old workspace type did not) — the relay's health bind dies with
# EADDRINUSE on a fresh import. Move the health listener off 8080 by default;
# the [[ports]] mapping in .replit forwards external 8080 to this port.
export BUZZ_HEALTH_PORT="${BUZZ_HEALTH_PORT:-18081}"

# Auto-wire Replit's managed (keyless) OpenRouter integration — the only
# keyless provider. Replit's AI Integrations inject
# AI_INTEGRATIONS_OPENROUTER_API_KEY / _BASE_URL; buzz-agent reads the
# OpenAI-compatible OPENAI_COMPAT_* names. Map them when the standard names
# aren't already set.
if [[ -z "${OPENAI_COMPAT_API_KEY:-}" ]] && [[ -n "${AI_INTEGRATIONS_OPENROUTER_API_KEY:-}" ]]; then
  export OPENAI_COMPAT_API_KEY="$AI_INTEGRATIONS_OPENROUTER_API_KEY"
  echo "==> Mapped AI_INTEGRATIONS_OPENROUTER_API_KEY → OPENAI_COMPAT_API_KEY for buzz-agent."
fi
if [[ -z "${OPENAI_COMPAT_BASE_URL:-}" ]] && [[ -n "${AI_INTEGRATIONS_OPENROUTER_BASE_URL:-}" ]]; then
  export OPENAI_COMPAT_BASE_URL="$AI_INTEGRATIONS_OPENROUTER_BASE_URL"
fi

# If a key is present but no provider is configured yet, default to the
# OpenAI-compatible provider with the chat dialect (OpenRouter is the only
# keyless option). An explicit BUZZ_AGENT_PROVIDER (env or admin-saved
# .env.agent, sourced later) always wins over this default.
if [[ -z "${BUZZ_AGENT_PROVIDER:-}" ]] && [[ -n "${OPENAI_COMPAT_API_KEY:-}" ]]; then
  export BUZZ_AGENT_PROVIDER="openai"
  export OPENAI_COMPAT_API="${OPENAI_COMPAT_API:-chat}"
  echo "==> OpenRouter keyless key detected — defaulting BUZZ_AGENT_PROVIDER=openai (openai-compat, chat dialect)."
fi

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

# Public community hosts the ACP worker must serve. The relay is
# host-tenant-bound (community resolved from the Host header), so one ACP
# connection binds to exactly ONE community. We run one worker per public
# host (custom domains, the .replit.app domain, or the dev domain) so the
# agent is reachable in every community users actually connect to.
ACP_HOSTS=""
_acp_add_host() {
  local h="$1"
  # Explicit `return 0` on both early paths: a bare `return` propagates $? of
  # the failed [[ -z "$h" ]] test above, and under `set -e` that kills the
  # whole script whenever a host is skipped (empty or duplicate). Production
  # hits the duplicate path because REPLIT_DOMAINS there also contains the
  # custom domain already added from BUZZ_CUSTOM_DOMAINS.
  [[ -z "$h" ]] && return 0
  case " ${ACP_HOSTS} " in *" ${h} "*) return 0 ;; esac
  ACP_HOSTS="${ACP_HOSTS:+${ACP_HOSTS} }${h}"
}
if [[ -n "${BUZZ_CUSTOM_DOMAINS:-}" ]]; then
  for _d in $(echo "${BUZZ_CUSTOM_DOMAINS}" | tr ',' ' '); do _acp_add_host "$_d"; done
fi
if [[ -n "${REPLIT_DOMAINS:-}" ]]; then
  for _d in $(echo "${REPLIT_DOMAINS}" | tr ',' ' '); do _acp_add_host "$_d"; done
elif [[ -n "${REPLIT_DEV_DOMAIN:-}" ]]; then
  _acp_add_host "${REPLIT_DEV_DOMAIN}"
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
# 1b. Media storage (S3-compatible).
#
# Priority order:
#   1. External S3-compatible bucket: set BUZZ_S3_ENDPOINT (non-loopback),
#      BUZZ_S3_ACCESS_KEY, BUZZ_S3_SECRET_KEY, BUZZ_S3_BUCKET as secrets.
#      Works in both dev and prod.
#   2. Replit App Storage (prod default): when REPLIT_DEPLOYMENT is set and
#      no external S3 endpoint is configured, start the GCS-S3 proxy sidecar
#      (scripts/gcs-s3-proxy.mjs) which talks to the Replit-provisioned GCS
#      bucket via the platform sidecar at 127.0.0.1:1106. Zero configuration
#      required — the bucket ID and credentials come from the sidecar.
#   3. Local MinIO (dev fallback): when neither of the above apply, download
#      and start MinIO with ephemeral .minio-data/. DEV ONLY — data is wiped
#      on every redeploy.
#
# In production, the GCS proxy is preferred over external S3 because it
# requires no secrets. Supply BUZZ_S3_ENDPOINT to override with your own
# bucket (e.g. Cloudflare R2, AWS S3, Backblaze B2).
# ---------------------------------------------------------------------------

# Dev defaults. Any value already set in the environment still wins.
export BUZZ_S3_ENDPOINT="${BUZZ_S3_ENDPOINT:-http://127.0.0.1:9000}"
export BUZZ_S3_ACCESS_KEY="${BUZZ_S3_ACCESS_KEY:-buzz_dev}"
export BUZZ_S3_SECRET_KEY="${BUZZ_S3_SECRET_KEY:-buzz_dev_secret}"
export BUZZ_S3_BUCKET="${BUZZ_S3_BUCKET:-buzz-media}"

_GCS_PROXY_PID=""

if [[ -n "${REPLIT_DEPLOYMENT:-}" && "${BUZZ_S3_ENDPOINT}" == "http://127.0.0.1:9000" ]]; then
  # Production with no external S3 configured: use Replit App Storage via the
  # GCS-S3 proxy. Check that the Replit sidecar is reachable first.
  SIDECAR_OK=false
  for _i in $(seq 1 10); do
    if (exec 3<>/dev/tcp/127.0.0.1/1106) 2>/dev/null; then
      SIDECAR_OK=true; break
    fi
    sleep 0.5
  done

  if [[ "${SIDECAR_OK}" == true ]]; then
    echo "==> Starting GCS-S3 proxy (Replit App Storage) on 127.0.0.1:9000..."
    # REPO_ROOT is not yet set here (it's defined later in the script); use
    # $(pwd) which is the repo root (set by the cd at the top of this script).
    node "$(pwd)/scripts/gcs-s3-proxy.mjs" &
    _GCS_PROXY_PID=$!

    # Wait for the proxy to be ready, but also watch for early exit.
    # The proxy exits immediately when the App Storage bucket is not provisioned
    # (sidecar returns empty bucketId); detect that case and fail the boot.
    _proxy_ready=false
    for _i in $(seq 1 20); do
      # If the proxy process has already exited, no point waiting further.
      if ! kill -0 "${_GCS_PROXY_PID}" 2>/dev/null; then
        break
      fi
      if (exec 3<>/dev/tcp/127.0.0.1/9000) 2>/dev/null; then
        _proxy_ready=true
        break
      fi
      sleep 0.5
    done

    if [[ "${_proxy_ready}" != true ]]; then
      # The deploy environment's sidecar does not serve the HTTP API the proxy
      # needs (socket accepted, HTTP connection closed) and no App Storage
      # bucket is provisioned yet — fall back to ephemeral MinIO so the
      # deployment can boot, instead of failing the whole publish.
      echo "==> WARNING: GCS-S3 proxy failed to start — falling back to ephemeral MinIO." >&2
      echo "==> WARNING: uploaded media will NOT survive redeploys until durable storage" >&2
      echo "==> WARNING: is restored: provision a bucket in the App Storage tool and/or set" >&2
      echo "==> WARNING: BUZZ_S3_ENDPOINT / BUZZ_S3_ACCESS_KEY / BUZZ_S3_SECRET_KEY /" >&2
      echo "==> WARNING: BUZZ_S3_BUCKET as production secrets (Cloudflare R2, AWS S3, B2)." >&2
      kill "${_GCS_PROXY_PID}" 2>/dev/null || true
      _GCS_FALLBACK_MINIO=true
    else
    echo "==> GCS-S3 proxy started (PID ${_GCS_PROXY_PID})."

    # Credentials are ignored by the proxy (it uses the sidecar token), but
    # the relay's S3 client requires non-empty values to build its client.
    export BUZZ_S3_ACCESS_KEY="gcs_proxy"
    export BUZZ_S3_SECRET_KEY="gcs_proxy_secret"
    _GCS_FALLBACK_MINIO=false
    fi
  else
    echo "==> WARNING: Replit sidecar at 127.0.0.1:1106 not reachable in deployment —" >&2
    echo "==> WARNING: falling back to ephemeral MinIO. Uploaded media will NOT survive" >&2
    echo "==> WARNING: redeploys. Restore durable storage: provision a bucket in the App" >&2
    echo "==> WARNING: Storage tool and/or set BUZZ_S3_ENDPOINT / BUZZ_S3_ACCESS_KEY /" >&2
    echo "==> WARNING: BUZZ_S3_SECRET_KEY / BUZZ_S3_BUCKET as production secrets." >&2
    _GCS_FALLBACK_MINIO=true
  fi
fi

if [[ ( -z "${REPLIT_DEPLOYMENT:-}" || "${_GCS_FALLBACK_MINIO:-false}" == true ) && "${BUZZ_S3_ENDPOINT}" == "http://127.0.0.1:9000" ]]; then
  if [[ -n "${REPLIT_DEPLOYMENT:-}" ]]; then
    echo "==> WARNING: running MinIO in production as a temporary fallback — media is ephemeral." >&2
  fi
  MINIO_BIN="bin-media/minio"
  if [[ ! -x "${MINIO_BIN}" ]]; then
    echo "==> Downloading MinIO server binary..."
    mkdir -p bin-media
    curl -fsSL -o "${MINIO_BIN}" https://dl.min.io/server/minio/release/linux-amd64/minio \
      && chmod +x "${MINIO_BIN}" \
      || echo "==> WARNING: MinIO download failed — media uploads will not work." >&2
  fi
  if [[ -x "${MINIO_BIN}" ]]; then
    if ! (exec 3<>/dev/tcp/127.0.0.1/9000) 2>/dev/null; then
      echo "==> Starting MinIO on 127.0.0.1:9000..."
      mkdir -p .minio-data
      MINIO_ROOT_USER="${BUZZ_S3_ACCESS_KEY}" MINIO_ROOT_PASSWORD="${BUZZ_S3_SECRET_KEY}" \
        nohup "${MINIO_BIN}" server .minio-data --address 127.0.0.1:9000 --console-address 127.0.0.1:9001 \
        >/tmp/minio.log 2>&1 &
      for _ in $(seq 1 20); do
        if (exec 3<>/dev/tcp/127.0.0.1/9000) 2>/dev/null; then break; fi
        sleep 0.5
      done
    else
      echo "==> MinIO already running."
    fi
    # Ensure the media bucket exists (idempotent; curl speaks SigV4 natively).
    _bucket_status=$(curl -s -o /dev/null -w '%{http_code}' -X PUT \
      --user "${BUZZ_S3_ACCESS_KEY}:${BUZZ_S3_SECRET_KEY}" \
      --aws-sigv4 "aws:amz:us-east-1:s3" \
      "http://127.0.0.1:9000/${BUZZ_S3_BUCKET}" || echo "000")
    case "${_bucket_status}" in
      200|409) echo "==> MinIO bucket '${BUZZ_S3_BUCKET}' ready (${_bucket_status})." ;;
      *) echo "==> WARNING: MinIO bucket create returned ${_bucket_status} — media uploads may fail." >&2 ;;
    esac
  fi
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
build_rust_bin_if_missing buzz buzz-cli
build_rust_bin_if_missing buzz-dev-mcp buzz-dev-mcp

# ---------------------------------------------------------------------------
# 3. Run migrations (idempotent — safe to run on every restart)
# ---------------------------------------------------------------------------
echo "==> Running database migrations..."
run_bin buzz-admin buzz-admin migrate

# ---------------------------------------------------------------------------
# 3b. One-shot data seed (workspace migration support).
#     If a seed JSON exists (produced by an agent-side export of the old
#     app's production data) AND this database has no channels yet, import
#     it before any community seeding. VM deployments snapshot the workspace
#     filesystem, so a gitignored backups/prod-seed.json ships in the image
#     without ever touching the git repo. Guarded on an empty DB so it can
#     never clobber real data.
# ---------------------------------------------------------------------------
SEED_FILE="${BUZZ_SEED_FILE:-backups/prod-seed.json}"
if [[ -f "$SEED_FILE" ]] && command -v psql >/dev/null 2>&1; then
  _CH_COUNT=$(psql "$DATABASE_URL" -tAc "SELECT count(*) FROM channels;" 2>/dev/null || echo "err")
  if [[ "$_CH_COUNT" == "0" ]]; then
    echo "==> Empty relay DB and seed file present — importing ${SEED_FILE}..."
    if ! bash scripts/import-json-export.sh "$SEED_FILE" --yes; then
      echo "==> FATAL: seed import failed. Refusing to start with an empty DB" >&2
      echo "==> while a seed file is staged (a silent empty relay would accept" >&2
      echo "==> new writes and defeat the migration). Fix or remove ${SEED_FILE}" >&2
      echo "==> and restart. The import is transactional, so the DB is still empty." >&2
      exit 1
    fi
  else
    echo "==> Seed file present but DB already has channels (${_CH_COUNT}) — skipping import."
  fi
fi

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
    # Register the ACP worker as a relay member in every community it serves.
    # The relay is host-tenant-bound: one ACP worker connection binds to ONE
    # community (by Host header), so we run one worker per public host (see
    # _start_acp) plus the loopback community, and each needs membership.
    # buzz-admin resolves community from RELAY_URL, so we override it per host.
    _BIND_PORT=$(echo "${BUZZ_BIND_ADDR:-0.0.0.0:5000}" | cut -d: -f2)
    for _ACP_COMMUNITY_HOST in "127.0.0.1:${_BIND_PORT}" ${ACP_HOSTS:-}; do
      RELAY_URL="ws://${_ACP_COMMUNITY_HOST}" \
        run_bin buzz-admin buzz-admin add-member --pubkey "$ACP_PUBKEY" >/dev/null 2>&1 \
        && echo "==> ACP worker registered as relay member (community: ${_ACP_COMMUNITY_HOST})." \
        || echo "==> ACP worker member registration skipped (already exists or error): ${_ACP_COMMUNITY_HOST}"
    done

    # Write the ACP pubkey into web/dist/assets/ so the relay's static file
    # handler (which only serves /assets/* paths) can serve it to the web UI.
    # The web UI fetches /assets/relay-info.json to learn the ACP pubkey before
    # publishing kind:9000 to add the agent as a channel member.
    if [[ -d web/dist/assets ]]; then
      # Check whether an AI provider is configured so the web UI can warn
      # users before they try to @mention the agent and see nothing.
      _PROVIDER_CONFIGURED="false"
      if [[ -f "${REPO_ROOT}/.env.agent" ]] && grep -q "^BUZZ_AGENT_PROVIDER=" "${REPO_ROOT}/.env.agent"; then
        _PROVIDER_CONFIGURED="true"
      fi
      if [[ -n "${BUZZ_AGENT_PROVIDER:-}" ]]; then
        _PROVIDER_CONFIGURED="true"
      fi
      printf '{"acp_pubkey":"%s","provider_configured":%s}\n' \
        "$ACP_PUBKEY" "$_PROVIDER_CONFIGURED" > web/dist/assets/relay-info.json
      echo "==> ACP pubkey written to web/dist/assets/relay-info.json (provider_configured=${_PROVIDER_CONFIGURED})"
    fi
  else
    echo "==> Warning: could not derive ACP pubkey — skipping member registration." >&2
  fi
fi

# ---------------------------------------------------------------------------
# 5c. Dev-only channel seed for the preview community.
#
#     The relay is host-tenant-bound: the Replit dev preview connects with the
#     REPLIT_DEV_DOMAIN Host header, so it binds to that community. After a
#     fresh import/seed all channels typically live in the production
#     community (custom domain), leaving the dev community empty — the ACP
#     worker logs "discovered 0 channel(s)" and the agent can never be tested
#     from the preview. Seed one open 'general' channel into the dev-domain
#     community when it has none. Startup reconciliation
#     (BUZZ_RECONCILE_CHANNELS=true) then emits the kind:39000/39002 discovery
#     events and backfills ACP agent membership, so the worker discovers it.
#
#     Guarded to development only (REPLIT_DEPLOYMENT unset) and to an empty
#     community, so production data is never touched.
# ---------------------------------------------------------------------------
if [[ -z "${REPLIT_DEPLOYMENT:-}" ]] && [[ -n "${REPLIT_DEV_DOMAIN:-}" ]] \
   && command -v psql >/dev/null 2>&1; then
  _DEV_HOST="${REPLIT_DEV_DOMAIN}"
  _DEV_CH_COUNT=$(psql "$DATABASE_URL" -tAc \
    "SELECT count(*) FROM channels ch JOIN communities c ON c.id = ch.community_id WHERE lower(c.host) = lower('${_DEV_HOST}');" \
    2>/dev/null || echo "err")
  if [[ "$_DEV_CH_COUNT" == "0" ]]; then
    echo "==> Dev community '${_DEV_HOST}' has no channels — seeding 'general' so the agent is testable from the preview..."
    _SYSTEM_PUBKEY="0000000000000000000000000000000000000000000000000000000000000000"
    _OWNER_HEX="${RELAY_OWNER_PUBKEY:-}"
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<SQL && echo "==> Dev 'general' channel seeded." \
      || echo "==> Warning: dev channel seed failed — agent may stay idle in the preview." >&2
DO \$\$
DECLARE
  cid uuid;
  ch uuid := gen_random_uuid();
BEGIN
  SELECT id INTO cid FROM communities WHERE lower(host) = lower('${_DEV_HOST}');
  IF cid IS NULL THEN
    RAISE EXCEPTION 'community % not found', '${_DEV_HOST}';
  END IF;
  INSERT INTO channels (community_id, id, name, channel_type, visibility, description, created_by)
  VALUES (cid, ch, 'general', 'stream', 'open', 'General discussion', decode('${_SYSTEM_PUBKEY}','hex'));
  IF length('${_OWNER_HEX}') = 64 THEN
    INSERT INTO channel_members (community_id, channel_id, pubkey, role, invited_by)
    VALUES (cid, ch, decode('${_OWNER_HEX}','hex'), 'owner', decode('${_SYSTEM_PUBKEY}','hex'))
    ON CONFLICT DO NOTHING;
  END IF;
END
\$\$;
SQL
  elif [[ "$_DEV_CH_COUNT" == "err" ]]; then
    echo "==> Warning: could not check dev community channels (psql error)." >&2
  else
    echo "==> Dev community '${_DEV_HOST}' already has ${_DEV_CH_COUNT} channel(s) — skipping dev seed."
  fi
fi

# ---------------------------------------------------------------------------
# 6. Start the relay
# ---------------------------------------------------------------------------
# Expose the ACP private key to the relay process so the admin API can sign
# kind:0 / kind:10100 profile events on behalf of the ACP agent.
export BUZZ_ACP_PRIVATE_KEY="${ACP_PRIVATE_KEY}"
export BUZZ_BIND_ADDR="${BUZZ_BIND_ADDR:-0.0.0.0:5000}"
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

# When the workflow is stopped, kill the watcher, relay, ACP worker, and GCS
# proxy cleanly.
_cleanup() {
  STOPPING=true
  [[ -n "$RELAY_PID" ]] && kill -TERM "$RELAY_PID" 2>/dev/null || true
  # shellcheck disable=SC2086 — ACP_PID may hold multiple PIDs (one worker per host).
  [[ -n "$ACP_PID"   ]] && kill -TERM $ACP_PID   2>/dev/null || true
  [[ -n "$WATCHER_PID" ]] && kill -TERM "$WATCHER_PID" 2>/dev/null || true
  [[ -n "$_GCS_PROXY_PID" ]] && kill -TERM "$_GCS_PROXY_PID" 2>/dev/null || true
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

  # Guard: the MCP command must exist or agent turns fail at runtime.
  local mcp_cmd="${BUZZ_ACP_MCP_COMMAND:-${REPO_ROOT}/target/release/buzz-dev-mcp}"
  if [[ ! -x "$mcp_cmd" ]]; then
    echo "==> Warning: MCP command '$mcp_cmd' not found/executable — agent tool calls will fail. Build it with: cargo build --ignore-rust-version -p buzz-dev-mcp --release" >&2
  fi

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

  # Source admin-configured AI provider credentials (.env.agent written by the admin UI).
  if [[ -f "${REPO_ROOT}/.env.agent" ]]; then
    # shellcheck disable=SC1090
    set -a; source "${REPO_ROOT}/.env.agent"; set +a
    echo "==> Loaded AI provider config from .env.agent (provider=${BUZZ_AGENT_PROVIDER:-none})."
  fi

  # OpenRouter is the only keyless provider — the keyless block above maps
  # AI_INTEGRATIONS_OPENROUTER_* to OPENAI_COMPAT_*. The native OpenAI
  # mapping was removed; BYOK OpenAI still works via OPENAI_COMPAT_API_KEY.

  # Validate: warn loudly when no provider is configured so failures are visible.
  if [[ -z "${BUZZ_AGENT_PROVIDER:-}" ]]; then
    echo "==> Warning: BUZZ_AGENT_PROVIDER is not set — buzz-agent will exit immediately." >&2
    echo "==>          Go to Admin → Settings → AI Provider to configure a provider." >&2
  fi

  # One worker per community host. The relay resolves the community from the
  # Host header, so each worker connects over loopback but presents the public
  # host via BUZZ_ACP_HOST_HEADER, binding it to that community. With no
  # public hosts (pure-local dev), fall back to a single loopback worker.
  local hosts="${ACP_HOSTS:-}"
  [[ -z "$hosts" ]] && hosts="127.0.0.1:${bind_port}"

  rm -f /tmp/buzz-acp.pid
  local host
  for host in $hosts; do
    local host_header="" nip42_url="${relay_scheme}://127.0.0.1:${bind_port}" nip98_url="${http_scheme}://127.0.0.1:${bind_port}" mcp_relay_url=""
    if [[ "$host" != "127.0.0.1:${bind_port}" ]]; then
      host_header="$host"
      nip42_url="${relay_scheme}://${host}"
      nip98_url="${http_scheme}://${host}"
      # The MCP server (buzz CLI) has no Host-header override, so point it at
      # the public URL whose host resolves to this worker's community.
      mcp_relay_url="${http_scheme}://${host}"
    fi
    echo "==> Starting ACP worker for community host '${host}' (relay=${acp_relay_url})..."
    RUST_LOG="${BUZZ_ACP_RUST_LOG:-buzz_acp=info,buzz_agent=info}" \
    BUZZ_PRIVATE_KEY="$ACP_PRIVATE_KEY" \
    BUZZ_RELAY_URL="$acp_relay_url" \
    BUZZ_ACP_HOST_HEADER="$host_header" \
    BUZZ_ACP_MCP_RELAY_URL="$mcp_relay_url" \
    BUZZ_ACP_NIP42_RELAY_URL="$nip42_url" \
    BUZZ_ACP_NIP98_BASE_URL="$nip98_url" \
    BUZZ_ACP_AGENT_OWNER="${RELAY_OWNER_PUBKEY:-}" \
    BUZZ_ACP_AGENT_COMMAND="${BUZZ_ACP_AGENT_COMMAND:-${REPO_ROOT}/target/release/buzz-agent}" \
    BUZZ_ACP_AGENT_ARGS="${BUZZ_ACP_AGENT_ARGS:-acp}" \
    BUZZ_ACP_SUBSCRIBE="${BUZZ_ACP_SUBSCRIBE:-mentions}" \
    BUZZ_ACP_LAZY_POOL="${BUZZ_ACP_LAZY_POOL:-true}" \
    BUZZ_ACP_RESPOND_TO="${BUZZ_ACP_RESPOND_TO:-anyone}" \
    BUZZ_ACP_MCP_COMMAND="${BUZZ_ACP_MCP_COMMAND:-${REPO_ROOT}/target/release/buzz-dev-mcp}" \
    "$ACP_BIN" 2>&1 &

    local pid=$!
    ACP_PID="${ACP_PID:+${ACP_PID} }${pid}"
    echo "$pid" >> /tmp/buzz-acp.pid
    echo "==> ACP worker started (PID ${pid}, community host ${host})."
  done
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
  # Source the admin-configured AI provider settings before starting the relay
  # binary so it inherits BUZZ_AGENT_PROVIDER in its environment.  This lets
  # the relay's /settings/agent-provider endpoint compute restart_required
  # correctly (comparing its own env against the saved file) from the very
  # first boot — without this, restart_required is always true on the initial
  # start because _start_acp (which sources .env.agent) runs after the relay.
  if [[ -f "${REPO_ROOT}/.env.agent" ]]; then
    set -a; source "${REPO_ROOT}/.env.agent"; set +a
  fi

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
    # shellcheck disable=SC2086 — ACP_PID may hold multiple PIDs (one worker per host).
    kill -TERM $ACP_PID 2>/dev/null || true
    wait $ACP_PID 2>/dev/null || true
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
# shellcheck disable=SC2086 — ACP_PID may hold multiple PIDs (one worker per host).
[[ -n "$ACP_PID"      ]] && kill -TERM $ACP_PID      2>/dev/null || true
