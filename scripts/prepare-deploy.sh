#!/usr/bin/env bash
# Run as the deployment build step to trim the image below the 8 GiB limit.
# Keeps only the pre-built release binaries; removes everything else in
# target/ and all node_modules (the start script reinstalls them on first boot).
set -euo pipefail

echo "==> Trimming target/ — keeping release binaries only..."

KEEP=(
  "target/release/buzz-relay"
  "target/release/buzz-admin"
)

# Stash the binaries we need
TMP=$(mktemp -d)
for bin in "${KEEP[@]}"; do
  if [[ -f "$bin" ]]; then
    cp "$bin" "$TMP/$(basename "$bin")"
    echo "    kept: $bin"
  else
    echo "    WARNING: $bin not found — will fall back to cargo run on first boot" >&2
  fi
done

# Wipe the whole target tree
rm -rf target/

# Restore the binaries
mkdir -p target/release
for bin in "${KEEP[@]}"; do
  name="$(basename "$bin")"
  if [[ -f "$TMP/$name" ]]; then
    cp "$TMP/$name" "target/release/$name"
    chmod +x "target/release/$name"
  fi
done
rm -rf "$TMP"

echo "==> Removing node_modules (reinstalled on first boot by start script)..."
rm -rf web/node_modules admin-web/node_modules node_modules

echo "==> Image cleanup complete."
du -sh target/ 2>/dev/null || true
