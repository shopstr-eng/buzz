#!/usr/bin/env bash
# Import a JSON data export into the CURRENT environment's database.
#
# The JSON format is a single object mapping table name -> array of row
# objects (as produced by `SELECT json_agg(t) FROM <table> t`), e.g.:
#   { "communities": [ {...}, ... ], "channels": [ {...} ], ... }
#
# Used for migrating relay data between Replit apps when only read-only SQL
# access to the source database is available (agent-side export). Tables are
# loaded in foreign-key-safe order inside one transaction; absent tables are
# skipped; sequences (serial AND identity) are re-synced afterwards.
#
# Column lists are built from the live catalog, excluding GENERATED columns
# (e.g. events.search_tsv) which must never be inserted explicitly. Tables
# with GENERATED ALWAYS identity columns (e.g. delivery_log.id) get
# OVERRIDING SYSTEM VALUE so original ids restore faithfully.
#
# Inserts use ON CONFLICT DO NOTHING, so pre-seeded rows (e.g. a community
# row auto-created at boot) don't abort the import. The whole load is one
# transaction: on any error nothing is committed.
#
# Usage: bash scripts/import-json-export.sh <export.json> [--yes]
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

JSON_FILE="${1:-}"
CONFIRM="${2:-}"

if [[ -z "$JSON_FILE" || ! -f "$JSON_FILE" ]]; then
  echo "Usage: bash scripts/import-json-export.sh <export.json> [--yes]" >&2
  exit 1
fi
if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "ERROR: DATABASE_URL is not set." >&2
  exit 1
fi

if [[ "$CONFIRM" != "--yes" ]]; then
  echo "This will INSERT relay data from ${JSON_FILE} into the current database."
  read -r -p "Type 'import' to continue: " ANSWER
  [[ "$ANSWER" == "import" ]] || { echo "Aborted."; exit 1; }
fi

# FK-safe load order (parents before children). Tables not present in the
# JSON contribute zero rows via COALESCE(...,'[]'). Migration bookkeeping
# tables (_sqlx_migrations, _operator_global_tables) are intentionally NOT
# in this list — the target app runs its own migrations.
TABLES=(
  communities
  relay_members
  users
  channels
  channel_members
  events
  event_mentions
  reactions
  thread_metadata
  audit_log
  archived_identities
  community_bans
  pubkey_allowlist
  relay_invites
  parameterized_event_watermarks
  product_feedback
  api_tokens
  subscriptions
  join_policy_acceptances
  moderation_actions
  moderation_reports
  workflows
  workflow_runs
  workflow_approvals
  scheduled_workflow_fires
  push_gateway_installations
  push_gateway_delegations
  push_leases
  push_match_queue
  push_wake_outbox
  delivery_log
  git_repo_names
)

SQL_FILE=$(mktemp)
trap 'rm -f "$SQL_FILE"' EXIT

{
  echo "\\set ON_ERROR_STOP on"
  # Read the JSON file into a psql variable (single-quoted literal semantics).
  echo "\\set j \`cat '${JSON_FILE}'\`"
  echo "BEGIN;"
} > "$SQL_FILE"

for t in "${TABLES[@]}"; do
  exists=$(psql "$DATABASE_URL" -tAc "SELECT to_regclass('public.${t}') IS NOT NULL;")
  if [[ "$exists" != "t" ]]; then
    echo "==> Table ${t} not in target schema — skipping." >&2
    continue
  fi
  # Insertable columns: skip dropped and GENERATED (STORED) columns.
  cols=$(psql "$DATABASE_URL" -tAc "
    SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum)
    FROM pg_attribute
    WHERE attrelid = 'public.${t}'::regclass
      AND attnum > 0 AND NOT attisdropped
      AND attgenerated = '';")
  if [[ -z "$cols" ]]; then
    echo "==> Table ${t} has no insertable columns — skipping." >&2
    continue
  fi
  # GENERATED ALWAYS identity columns need OVERRIDING SYSTEM VALUE to accept
  # explicit ids from the export.
  has_always_identity=$(psql "$DATABASE_URL" -tAc "
    SELECT EXISTS (
      SELECT 1 FROM pg_attribute
      WHERE attrelid = 'public.${t}'::regclass
        AND attnum > 0 AND NOT attisdropped
        AND attidentity = 'a');")
  overriding=""
  [[ "$has_always_identity" == "t" ]] && overriding="OVERRIDING SYSTEM VALUE"
  cat >> "$SQL_FILE" <<SQL
INSERT INTO ${t} (${cols}) ${overriding}
  SELECT ${cols} FROM jsonb_populate_recordset(
    NULL::public.${t},
    COALESCE((:'j'::jsonb)->'${t}', '[]'::jsonb))
ON CONFLICT DO NOTHING;
SQL
done

# Re-sync all serial ('a') and identity ('i') sequences to MAX(column)+1 so
# future inserts don't collide with imported ids.
cat >> "$SQL_FILE" <<'SQL'
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT seq.oid AS seqoid, tab.relname AS tabname, attr.attname AS colname
    FROM pg_class seq
    JOIN pg_depend dep ON dep.objid = seq.oid AND dep.deptype IN ('a', 'i')
    JOIN pg_class tab ON dep.refobjid = tab.oid
    JOIN pg_attribute attr ON attr.attrelid = tab.oid AND attr.attnum = dep.refobjsubid
    WHERE seq.relkind = 'S'
  LOOP
    EXECUTE format(
      'SELECT setval(%L, COALESCE((SELECT MAX(%I) FROM %I), 0) + 1, false)',
      r.seqoid::regclass::text, r.colname, r.tabname);
  END LOOP;
END $$;
COMMIT;
SQL

echo "==> Importing ${JSON_FILE} ..."
psql "$DATABASE_URL" -q -f "$SQL_FILE"

echo "==> Import complete. Row counts:"
for t in communities relay_members channels channel_members events; do
  n=$(psql "$DATABASE_URL" -tAc "SELECT count(*) FROM ${t};" 2>/dev/null || echo "n/a")
  echo "    ${t}: ${n}"
done
