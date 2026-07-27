---
name: buzz-acp-loopback-auth
description: NIP-42/NIP-98 scheme mismatch when ACP connects via ws:// loopback to wss:// relay; port 8080 collision on restart.
---

## NIP-42 loopback auth mismatch

The ACP worker connects to the relay via `ws://127.0.0.1:5000` (plaintext loopback) but the relay's public `relay_url` is `wss://…replit.dev` (TLS). NIP-42 AUTH events are bound to the relay URL, so if the ACP signs against the loopback URL it will be rejected.

**Fix carried in the repo:** `scripts/start-replit.sh` sets `RELAY_URL` to the loopback URL for the ACP subprocess, overriding the public URL just for that process. Do not change that override.

**Why:** Without the override, buzz-acp can connect but NIP-42 auth silently fails, which looks like the agent is running but produces no channel activity.

**How to apply:** If ACP auth breaks after a script change, check that the ACP subprocess still gets `RELAY_URL=ws://127.0.0.1:5000`.

---

## Port 8080 collision on workflow restart

When the Buzz Relay workflow is killed mid-run, the `buzz-relay` process may leave port 8080 (health probe) occupied. The next `start-replit.sh` run will fail at the very end with:

```
Error: Failed to bind health port 8080: Address already in use (os error 98)
```

**Fix:** Simply restart the workflow a second time immediately. The orphan process will have been killed by then and port 8080 will be free.

**Why:** The workflow runner sends SIGTERM to the script but child processes spawned with `&` may outlive the script briefly. The health-port bind happens after all other initialization, so the relay otherwise starts cleanly.
