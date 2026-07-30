---
name: Agent typing but never responds
description: Symptom→cause map for the built-in agent showing typing but no reply, the kind:9000 repair procedure, and prod DB query quirks (bytea pubkeys).
---

## Symptom → cause

"Agent shows typing in a channel but the reply never arrives" has (so far) always meant the **response publish was rejected**, not an LLM failure. The ACP logs the drop only as a WARN on `POST /events` (status 403, accepted=false) and typing continues until idle timeout.

- First root cause (2026-07-30): agent pubkey was a **relay member but not a channel member**. Typing (kind 20002, ephemeral) is exempt from channel-membership checks; the reply (kind 9) is not → 403 AuthFailed.
- Seeded/restored channels never contain the agent: membership comes from the web UI's ConnectAgentDialog (kind:9000, tags `[["h",channelId],["p",agentPubkey],["role","member"]]`), which never ran for seed-imported channels.

**Why:** channel membership and relay membership are separate tables/checks; ephemeral kinds skip the channel check, regular kinds don't.

**How to apply:** on this symptom, check `channel_members` for the agent pubkey in that channel before suspecting the LLM path. Repair = owner-signed kind:9000 via the HTTP bridge (`POST https://<host>/events`, NIP-98 auth) — script pattern in `/tmp/acp_repair.py` (pure-python BIP-340 + NIP-98, no deps; /tmp is ephemeral, recreate as needed).

## Prod DB query quirks

- `events.id`, `events.pubkey`, `channel_members.pubkey` are **bytea** — compare with `decode('<hex>','hex')`; hex-text comparison silently returns zero rows (no error). Output shows `\x…`.
- `events.created_at` is timestamptz — compare with `to_timestamp(<unix>)` or intervals, not integers.
- Prod DB is read-only from tools; event writes must go through the relay's ingest paths (bridge/WS), never SQL.

## Residual unexplained 403

After a successful reply, the ACP issues one more `POST /events` that 403s (seen 2026-07-30 03:39:49 and earlier at 03:25). Likely observer-telemetry/presence frame, not user-visible. Not yet identified.
