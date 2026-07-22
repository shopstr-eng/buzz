# Buzz 🐝 — Relay + Web Frontend on Replit

## Project overview

Buzz is a self-hostable team workspace where humans and AI agents collaborate over a Nostr relay. Every message, reaction, workflow step, and git event is a signed Nostr event in one append-only log.

**Stack:**
- **Relay** — Rust / Axum WebSocket + HTTP server (`crates/buzz-relay/`)
- **Web frontend** — React + Vite + Tailwind (`web/`) — bundled and served by the relay
- **Admin UI** — React + Vite (`admin-web/`) — served at `/admin`
- **Desktop app** — Tauri shell embedding the same web UI (`desktop/`) — not used in Replit deployment
- **Database** — PostgreSQL 17 (`crates/buzz-db/`, SQLx migrations)
- **Cache / pub-sub** — Redis 7
- **Search** — Typesense (`crates/buzz-search/`)
- **Media / blobs** — MinIO (Blossom protocol)

**Auth model:** NIP-42 (WebSocket) and NIP-98 (HTTP) — keypair-based, no password or OAuth needed for Nostr clients.

## User goals for this Replit deployment

The user wants a **private, single-group Buzz instance** running on Replit:

1. **Relay accessible over `wss://`** via a custom domain — fully open WebSocket endpoint, gated by relay-level NIP-42 auth for members of the configured group.
2. **Web UI served from the same domain** — the React `web/` app bundled and served by the relay at `/`. No native Tauri desktop app for this deployment.
3. **Admin UI at `/admin`** — the `admin-web/` React app served by the relay.
4. **Locked to one community/group** — no multi-tenant management; the instance serves exactly one relay and one group. Users join via invite link (web or desktop).
5. **Invite flow via web** — new members can claim invites by visiting the domain in a browser (the relay already has `POST /api/invites/claim` and a browser landing page at `/invite/:code`).

## Architecture notes

- `BUZZ_WEB_DIR` env var tells the relay where to find the built `web/dist` bundle to serve at `/`
- `BUZZ_ADMIN_WEB_DIR` env var tells the relay where to find the built `admin-web/dist` to serve at `/admin`
- The relay supports single-tenant mode — community is derived from `RELAY_URL` domain
- `crates/buzz-relay/src/api/invites.rs` — invite mint + claim (admin-gated mint, claim is public)
- `crates/buzz-relay/src/api/admin/` — admin REST API (includes invite minting without NIP-98)
- `RELAY_URL` env var must be set to the public `wss://` URL for NIP-42 auth challenges to work
- `BUZZ_BIND_ADDR` should bind to `0.0.0.0:3000` (Replit proxies external traffic to port 3000)

## Single-community invite-only setup (first-time)

### Step 1 — Set required secrets in Replit

Open **Secrets** in the Replit sidebar and add:

| Secret | Value |
|---|---|
| `DATABASE_URL` | Replit PostgreSQL connection string |
| `REDIS_URL` | Redis connection string (e.g. Upstash) |
| `RELAY_URL` | Your public WSS URL, e.g. `wss://your-repl.replit.dev` |
| `BUZZ_BIND_ADDR` | `0.0.0.0:3000` |

### Step 2 — Generate the admin keypair

Run the following in the Replit Shell:

```bash
cargo run -p buzz-admin --bin buzz-admin -- generate-key
```

This prints a **Public key** and a **Secret key**. Add both to Replit Secrets:

| Secret | Value |
|---|---|
| `BUZZ_RELAY_PRIVATE_KEY` | The hex **Secret key** from above |
| `RELAY_OWNER_PUBKEY` | The hex **Public key** from above |

### Step 3 — Run migrations and seed the community

```bash
bash scripts/setup-replit-instance.sh
```

This will:
- Run all pending database migrations
- Create the community row in the DB derived from `RELAY_URL`
- Confirm the relay owner (your pubkey) is bootstrapped as a member

### Step 4 — Enable invite-only membership gate

Add this to Replit Secrets:

| Secret | Value |
|---|---|
| `BUZZ_REQUIRE_RELAY_MEMBERSHIP` | `true` |

This ensures only members (those who claimed a valid invite) can connect to the relay.

### Step 5 — Build and start the relay

```bash
# Build the web frontend
cd web && npm install && npm run build && cd ..

# Build the admin UI
cd admin-web && npm install && npm run build && cd ..

# Start the relay (serves web UI at / and admin UI at /admin)
BUZZ_WEB_DIR=./web/dist BUZZ_ADMIN_WEB_DIR=./admin-web/dist \
  cargo run -p buzz-relay --release
```

### Step 6 — Mint your first invite link

Visit the admin panel in your browser: `https://your-repl.replit.dev/admin`

Go to **Invites** → **Generate invite link** → copy the URL.

Share the link with new members. They visit it in a browser, claim it, and their pubkey is added to the workspace.

> **No NIP-98 keypair required** in the admin UI — the admin panel is protected by the admin host check, so you can mint invites directly from your browser.

## Required environment variables (set in Replit Secrets)

| Variable | Description |
|---|---|
| `DATABASE_URL` | Replit PostgreSQL connection string |
| `REDIS_URL` | Redis connection string (Upstash or in-process) |
| `RELAY_URL` | Public WSS URL e.g. `wss://your-domain.com` |
| `BUZZ_BIND_ADDR` | `0.0.0.0:3000` |
| `BUZZ_RELAY_PRIVATE_KEY` | 32-byte hex — stable relay signing key (generate once with `buzz-admin generate-key`) |
| `RELAY_OWNER_PUBKEY` | Hex public key corresponding to `BUZZ_RELAY_PRIVATE_KEY` |
| `BUZZ_REQUIRE_RELAY_MEMBERSHIP` | `true` — enables invite-only membership gate |
| `TYPESENSE_URL` | Typesense HTTP URL (optional — search feature) |
| `TYPESENSE_API_KEY` | Typesense key (optional) |

## How to run

The **Buzz Relay** workflow handles everything automatically via `bash scripts/start-replit.sh`. It:
1. Starts Redis (daemonized, in-process)
2. Runs DB migrations (`cargo run -p buzz-admin --ignore-rust-version -- migrate`)
3. Seeds the community row from `RELAY_URL`
4. Builds and starts the relay (`cargo run -p buzz-relay --release --ignore-rust-version`)

**First deploy only** — build the web frontends before starting the workflow:
```bash
(cd web && npm install && npm run build)
(cd admin-web && npm install && npm run build)
```
Built bundles in `web/dist/` and `admin-web/dist/` are served automatically.

### Rust toolchain note
`rust-toolchain.toml` pins to 1.95.0, but Replit's Nix channel provides 1.88.0 (`rust-stable`
module). All crates compile fine on 1.88.0. The `--ignore-rust-version` flag is passed to
suppress version-guard errors. Do **not** prepend `/home/runner/workspace/bin` to PATH — the
hermit cargo shim there routes through a broken rustc 1.95.0 with a TLS shared-library error.

## Invite flow summary

1. **Admin mints an invite** — visit `/admin` → Invites → Generate invite link (browser, no keypair needed), or `POST /api/invites` with NIP-98 auth from the owner keypair.
2. **New member visits the invite URL** — e.g. `https://your-domain.com/invite/<code>` — the web UI shows an onboarding screen.
3. **Member claims the invite** — the browser calls `POST /api/invites/claim` with NIP-98 auth from the member's keypair. The relay adds their pubkey to `relay_members`.
4. **Member connects** — subsequent WebSocket connections pass the NIP-42 membership check and are admitted.

Non-invited connections are **rejected** when `BUZZ_REQUIRE_RELAY_MEMBERSHIP=true`.

## Common dev commands

```bash
just build          # Build entire Rust workspace
just test-unit      # Unit tests (no infra required)
just check          # fmt + clippy + desktop check
```

## User preferences

- Single-group / single-community mode — do not build multi-tenant management UI
- Web-first — no Tauri native desktop dependency for the Replit deployment
- Custom domain over WSS — `RELAY_URL` must always be the public `wss://` domain
- Admin UI accessible via the web at `/admin` path on the same domain
