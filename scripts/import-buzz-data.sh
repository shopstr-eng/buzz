#!/usr/bin/env bash
# Import a Buzz data export (created by scripts/export-buzz-data.sh) into the
# CURRENT environment's database. Intended for restoring into a fresh Replit
# app after a workspace migration.
#
# WARNING: This REPLACES existing relay data in the target database
# (pg_restore --clean). Do not run against a database with data you care about.
#
# Usage: bash scripts/import-buzz-data.sh backups/buzz-export-<timestamp>.tar.gz [--yes]
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

TARBALL="${1:-}"
CONFIRM="${2:-}"

if [[ -z "$TARBALL" || ! -f "$TARBALL" ]]; then
  echo "Usage: bash scripts/import-buzz-data.sh <export-tarball> [--yes]" >&2
  exit 1
fi
if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "ERROR: DATABASE_URL is not set." >&2
  exit 1
fi

if [[ "$CONFIRM" != "--yes" ]]; then
  echo "This will REPLACE relay data in the current database:"
  psql "$DATABASE_URL" -tAc "SELECT current_database() || ' @ ' || inet_server_addr()::text;" 2>/dev/null || true
  read -r -p "Type 'replace' to continue: " ANSWER
  [[ "$ANSWER" == "replace" ]] || { echo "Aborted."; exit 1; }
fi

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
tar -xzf "$TARBALL" -C "$WORK"
DIR=$(find "$WORK" -maxdepth 1 -mindepth 1 -type d | head -1)

echo "==> Manifest of export:"
cat "${DIR}/manifest.txt" 2>/dev/null || echo "(no manifest)"

echo "==> Restoring database..."
pg_restore --clean --if-exists --no-owner --no-privileges -d "$DATABASE_URL" "${DIR}/db.dump"

if [[ -f "${DIR}/repos.tar.gz" ]]; then
  echo "==> Restoring repos/ ..."
  tar -xzf "${DIR}/repos.tar.gz"
fi

echo "==> Import complete. Restart the relay workflow to pick up restored state."
