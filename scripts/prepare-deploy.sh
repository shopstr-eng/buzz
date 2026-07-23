#!/usr/bin/env bash
# Run as the deployment build step to:
# 1. Pre-build the web UIs so production boot skips npm install entirely.
# 2. Trim target/ to just the release binaries to stay under the 8 GiB image limit.
# 3. Remove node_modules after building (they're no longer needed in the image).
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

# ---------------------------------------------------------------------------
# 1. Build web UIs (bake fresh dist/ into the image)
# ---------------------------------------------------------------------------
build_ui() {
  local dir="$1"
  local name="$2"
  echo "==> Building ${name} for production..."
  if [[ ! -d "${dir}/node_modules" ]]; then
    (cd "${dir}" && npm install --prefer-offline)
  fi
  (cd "${dir}" && npm run build)
  echo "==> ${name} build complete."
}

build_ui "web" "web UI"
build_ui "admin-web" "admin UI"

# ---------------------------------------------------------------------------
# 2. Build Rust binaries (relay, admin, ACP harness, agent)
# ---------------------------------------------------------------------------

# Use the Nix-managed Rust toolchain (same guard as start-replit.sh).
unset RUSTUP_TOOLCHAIN RUSTUP_HOME
export PATH=$(printf '%s' "$PATH" | tr ':' '\n' | grep -v '/home/runner/workspace/bin' | paste -sd ':')

build_rust_bin() {
  local pkg="$1"
  local bin="$2"
  if [[ ! -x "target/release/${bin}" ]]; then
    echo "==> Building ${bin} (${pkg})..."
    cargo build -p "$pkg" --release --ignore-rust-version 2>&1
    echo "==> ${bin} build complete."
  else
    echo "==> ${bin} already built, skipping."
  fi
}

build_rust_bin buzz-relay  buzz-relay
build_rust_bin buzz-admin  buzz-admin
build_rust_bin buzz-acp    buzz-acp
build_rust_bin buzz-agent  buzz-agent

# ---------------------------------------------------------------------------
# 3. Strip target/ — keep only the pre-built release binaries
# ---------------------------------------------------------------------------
echo "==> Trimming target/ — keeping release binaries only..."

KEEP=(
  "target/release/buzz-relay"
  "target/release/buzz-admin"
  "target/release/buzz-acp"
  "target/release/buzz-agent"
)

TMP=$(mktemp -d)
for bin in "${KEEP[@]}"; do
  if [[ -f "$bin" ]]; then
    cp "$bin" "$TMP/$(basename "$bin")"
    echo "    kept: $bin"
  else
    echo "    WARNING: $bin not found — relay will fall back to cargo run on first boot" >&2
  fi
done

rm -rf target/

mkdir -p target/release
for bin in "${KEEP[@]}"; do
  name="$(basename "$bin")"
  if [[ -f "$TMP/$name" ]]; then
    cp "$TMP/$name" "target/release/$name"
    chmod +x "target/release/$name"
  fi
done
rm -rf "$TMP"

# ---------------------------------------------------------------------------
# 3. Remove node_modules — dist/ is baked in; start script skips install
# ---------------------------------------------------------------------------
echo "==> Removing node_modules (dist/ already baked into image)..."
rm -rf web/node_modules admin-web/node_modules desktop/node_modules node_modules

# Also clear any heavy tool caches that postinstall scripts may have populated
# (Playwright browser downloads, Tauri CLI binaries, etc.)
rm -rf "${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}"
rm -rf "${HOME}/.tauri" "${HOME}/.local/share/tauri" 2>/dev/null || true

echo "==> Image cleanup complete."
du -sh target/ web/dist admin-web/dist 2>/dev/null || true
