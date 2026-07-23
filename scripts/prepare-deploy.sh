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
# 2. Strip target/ — keep only the pre-built release binaries
# ---------------------------------------------------------------------------
echo "==> Trimming target/ — keeping release binaries only..."

KEEP=(
  "target/release/buzz-relay"
  "target/release/buzz-admin"
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
rm -rf web/node_modules admin-web/node_modules node_modules

echo "==> Image cleanup complete."
du -sh target/ web/dist admin-web/dist 2>/dev/null || true
