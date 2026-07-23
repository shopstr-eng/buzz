---
name: buzz-acp loopback auth quirks
description: How to connect buzz-acp to a wss:// relay via ws:// loopback without auth failures, and the _wait_for_relay bash timing fix.
---

## Problem
`buzz-acp` connects via `ws://127.0.0.1:5000` (plain loopback) to avoid TLS cert issues.
The relay's `RELAY_URL` is `wss://...` which causes two independent auth failures:

### NIP-42 scheme mismatch
`nip42_expected_relay_url()` in the relay derives the expected auth URL as `{config_scheme}://{tenant.host()}`.
With `RELAY_URL=wss://...`, scheme=`wss`, expected = `wss://127.0.0.1:5000`.
ACP signs with `ws://127.0.0.1:5000` → relay rejects with "relay url mismatch".

### NIP-98 scheme mismatch
`nip98_expected_url()` similarly derives `https://127.0.0.1:5000/query`.
ACP's `RestClient` uses `relay_ws_to_http(ws://...)` = `http://...` for signing → relay returns 401.
The actual TCP connection still goes to `http://` — only the signed URL in the event needs `https://`.

## Fix
Two new env vars in `crates/buzz-acp/src/relay.rs`:
- `BUZZ_ACP_NIP42_RELAY_URL` — overrides the relay URL placed in NIP-42 AUTH events
- `BUZZ_ACP_NIP98_BASE_URL` — overrides the base URL placed in NIP-98 signed events

`RestClient` was split into `base_url` (for NIP-98 signing) and `connect_base_url` (for actual HTTP connections).

In `start-replit.sh`, set:
```bash
relay_scheme=$(echo "${RELAY_URL:-ws://...}" | cut -d: -f1)   # wss
http_scheme=https  # when relay_scheme == wss
BUZZ_ACP_NIP42_RELAY_URL="${relay_scheme}://127.0.0.1:${port}"
BUZZ_ACP_NIP98_BASE_URL="${http_scheme}://127.0.0.1:${port}"
```

**Why:** The relay verifies auth URLs against the tenant host + config scheme. Loopback connections use a different scheme from the canonical relay URL. The env var overrides let ACP sign with what the relay expects while connecting via plain TCP.

## _wait_for_relay bash timing fix
The original `while ! bash -c "echo > /dev/tcp/..."` was intermittently treating the check as failing even when the port was open. The fix: use explicit `local rc=$?` pattern:
```bash
while true; do
  bash -c "echo > /dev/tcp/127.0.0.1/${port}" 2>/dev/null
  local rc=$?
  [[ $rc -eq 0 ]] && return 0
  sleep 0.5
  tries=$((tries + 1))
  [[ $tries -ge 60 ]] && return 1
done
```
Also increased timeout from 10s to 30s (60 * 0.5s).
