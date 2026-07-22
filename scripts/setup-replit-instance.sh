#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Buzz Replit instance bootstrap
#
# Run this once after the relay is first deployed to:
#   1. Generate a stable relay signing keypair (if BUZZ_RELAY_PRIVATE_KEY is
#      not already set in Replit Secrets).
#   2. Run pending database migrations.
#   3. Seed the community row derived from RELAY_URL so host binding works.
#
# Prerequisites (set these in Replit Secrets first):
#   DATABASE_URL   - Replit PostgreSQL connection string
#   RELAY_URL      - Public WSS URL, e.g. wss://your-domain.replit.dev
#
# Usage:
#   bash scripts/setup-replit-instance.sh
# ---------------------------------------------------------------------------
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

# ---------------------------------------------------------------------------
# 1. Generate relay keypair (if not already configured)
# ---------------------------------------------------------------------------
if [[ -z "${BUZZ_RELAY_PRIVATE_KEY:-}" ]]; then
  echo "==> Generating a new relay signing keypair…"
  echo ""
  echo "    Run the buzz-admin CLI to get a keypair:"
  echo ""
  echo "      cargo run -p buzz-admin --bin buzz-admin -- generate-key"
  echo ""
  echo "    Then add the 'Secret key' output to Replit Secrets as:"
  echo "      BUZZ_RELAY_PRIVATE_KEY=<hex secret key>"
  echo "      RELAY_OWNER_PUBKEY=<hex public key>"
  echo ""
  echo "    After setting those secrets, re-run this script."
  echo ""
  # Auto-generate and print if we can build quickly
  if cargo run -p buzz-admin --bin buzz-admin -- generate-key 2>/dev/null; then
    echo ""
    echo "==> Copy the 'Secret key' above into Replit Secrets as BUZZ_RELAY_PRIVATE_KEY."
    echo "==> Copy the 'Public key' above into Replit Secrets as RELAY_OWNER_PUBKEY."
    echo ""
    echo "    Then re-run this script to finish setup."
  fi
  exit 0
fi

echo "==> BUZZ_RELAY_PRIVATE_KEY is set. Continuing setup…"

# ---------------------------------------------------------------------------
# 2. Run database migrations
# ---------------------------------------------------------------------------
echo ""
echo "==> Running database migrations…"
cargo run -p buzz-db --bin buzz-migrate

echo "==> Migrations complete."

# ---------------------------------------------------------------------------
# 3. Seed the community row from RELAY_URL
# ---------------------------------------------------------------------------
echo ""
echo "==> Seeding community row from RELAY_URL='${RELAY_URL:-ws://localhost:3000}'…"
bash "${SCRIPT_DIR}/seed-local-community.sh"

echo ""
echo "==> Setup complete!"
echo ""
echo "    Start the relay with:"
echo "      BUZZ_WEB_DIR=./web/dist cargo run -p buzz-relay --release"
echo ""
echo "    Then visit the admin panel to generate invite links:"
if [[ -n "${RELAY_URL:-}" ]]; then
  HTTP_URL="${RELAY_URL/wss:\/\//https://}"
  HTTP_URL="${HTTP_URL/ws:\/\//http://}"
  echo "      ${HTTP_URL}/admin → Invites"
fi
echo ""
echo "    Alternatively, mint an invite from the CLI:"
echo "      curl -s -X POST \${RELAY_URL/ws/http}/api/invites \\"
echo "           -H 'Content-Type: application/json' \\"
echo "           -d '{\"ttl_secs\": 259200}'"
echo "      (Note: /api/invites requires NIP-98 auth from the relay owner keypair.)"
echo "      The admin panel (/admin → Invites) does not require NIP-98."
