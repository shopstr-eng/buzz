---
name: Agent typing but never responds
description: Symptom→cause map for the built-in agent showing typing but no reply, the kind:9000 repair procedure, and prod DB query quirks (bytea pubkeys).
---

## Symptom → cause

"Agent shows typing in a channel but the reply never arrives" has (so far) always meant the **response publish was rejected**, not an LLM failure. The ACP logs the drop only as a WARN on `POST /events` (status 403, accepted=false) and typing continues until idle timeout.

- First root cause (2026-07-30): agent pubkey was a **relay member but not a channel member**. Typing (kind 20002, ephemeral) is exempt from channel-membership checks; the reply (kind 9) is not → 403 AuthFailed.
- Seeded/restored channels never contain the agent: membership comes from the web UI's ConnectAgentDialog (kind:9000, tags `[["h",channelId],["p",agentPubkey],["role","member"]]`), which never ran for seed-imported channels.

**Why:** channel membership and relay membership are separate tables/checks; ephemeral kinds skip the channel check, regular kinds don't.

**Fixed structurally (2026-07-30):** the relay now derives the ACP pubkey from `BUZZ_ACP_PRIVATE_KEY` (config `acp_pubkey`) and (a) treats it as an implicit member in the publish membership check, (b) auto-adds it on stream/forum channel creation, and (c) backfills membership at startup via the channel reconciler (gated on `BUZZ_RECONCILE_CHANNELS`, now defaulted on in start-replit.sh). DM/workflow channels are deliberately excluded from auto-add.

**How to apply:** if this symptom recurs, first confirm the running relay binary predates the fix or `BUZZ_ACP_PRIVATE_KEY` is unset; otherwise check `channel_members` for the agent pubkey in that channel before suspecting the LLM path. Repair = owner-signed kind:9000 via the HTTP bridge (`POST https://<host>/events`, NIP-98 auth) — script pattern in `/tmp/acp_repair.py` (pure-python BIP-340 + NIP-98, no deps; /tmp is ephemeral, recreate as needed).

## Prod DB query quirks

- `events.id`, `events.pubkey`, `channel_members.pubkey` are **bytea** — compare with `decode('<hex>','hex')`; hex-text comparison silently returns zero rows (no error). Output shows `\x…`.
- `events.created_at` is timestamptz — compare with `to_timestamp(<unix>)` or intervals, not integers.
- Prod DB is read-only from tools; event writes must go through the relay's ingest paths (bridge/WS), never SQL.

## Post-reply 403 (identified & fixed 2026-07-30)

The one extra `POST /events` 403 after every successful reply was the **kind:44200 agent turn metric**. Ingest requires `users.agent_owner_pubkey` (via `is_agent_owner`) to match the metric's `p` tag, but the built-in ACP gets its owner from `BUZZ_ACP_AGENT_OWNER` env — no NIP-OA auth tag exists, so ownership could never be proven and every metric 403'd (zero 44200 rows in prod/dev).

**Fix (relay-side, needs republish to protect prod):** (a) startup bootstrap in `main.rs` materializes ACP→relay-owner mapping in every community where the ACP is a relay member; (b) the HTTP bridge now extracts a NIP-OA owner from `x-auth-tag` even when the caller is a direct member (previously only on the delegation-fallback path), so tag-bearing agents self-materialize.

**How to apply:** if post-reply 403s reappear, check `users.agent_owner_pubkey` for the ACP pubkey in that community first.
