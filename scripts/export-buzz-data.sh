#!/usr/bin/env bash
# Export all Buzz relay data from this Replit workspace into a single tarball.
#
# Captures:
#   - Full PostgreSQL dump (custom format, pg_restore-compatible)
#   - repos/ directory (git hosting working data), if non-empty
#   - A manifest with counts so the import side can sanity-check
#
# Output: backups/buzz-export-<timestamp>.tar.gz
#
# Usage: bash scripts/export-buzz-data.sh
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "ERROR: DATABASE_URL is not set." >&2
  exit 1
fi

STAMP=$(date +%Y%m%d-%H%M%S)
WORK="backups/buzz-export-${STAMP}"
mkdir -p "$WORK"

echo "==> Dumping database..."
pg_dump "$DATABASE_URL" --no-owner --no-privileges -Fc -f "${WORK}/db.dump"

echo "==> Capturing manifest..."
{
  echo "exported_at=${STAMP}"
  echo "db_size=$(psql "$DATABASE_URL" -tAc "SELECT pg_size_pretty(pg_database_size(current_database()));" | tr -d ' ')"
  for t in events channels channel_members users git_repo_names workflows communities; do
    n=$(psql "$DATABASE_URL" -tAc "SELECT count(*) FROM ${t};" 2>/dev/null || echo "n/a")
    echo "count_${t}=${n}"
  done
} > "${WORK}/manifest.txt"
cat "${WORK}/manifest.txt"

if [[ -d repos ]] && [[ -n "$(ls -A repos 2>/dev/null)" ]]; then
  echo "==> Archiving repos/ ..."
  tar -czf "${WORK}/repos.tar.gz" repos
else
  echo "==> repos/ empty or absent — skipping."
fi

echo "==> Creating final tarball..."
tar -czf "backups/buzz-export-${STAMP}.tar.gz" -C backups "buzz-export-${STAMP}"
rm -rf "$WORK"

echo "==> Done: backups/buzz-export-${STAMP}.tar.gz"
ls -lh "backups/buzz-export-${STAMP}.tar.gz"
