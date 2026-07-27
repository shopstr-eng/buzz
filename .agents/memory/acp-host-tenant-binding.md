---
name: ACP host-tenant binding on Buzz relay
description: Why loopback-connected ACP workers/MCP subprocesses bind to the wrong community and how the env overrides fix it.
---

The relay resolves community strictly from the Host header. Anything connecting via `ws://127.0.0.1:5000` binds to the loopback community and cannot see or post into channels of the public-domain community.

**Rule:** every process that talks to the relay for a given community must present that community's host — either via a Host-header override or by using the public URL.

- ACP worker: `BUZZ_ACP_HOST_HEADER=<host>` (WS handshake + HTTP bridge), plus `BUZZ_ACP_NIP42_RELAY_URL=wss://<host>` and `BUZZ_ACP_NIP98_BASE_URL=https://<host>` (relay validates auth URLs against its own scheme/host).
- MCP subprocess (buzz CLI has no Host override): `BUZZ_ACP_MCP_RELAY_URL=https://<host>` — otherwise agent replies are rejected 403 by the bridge while typing/reaction events (sent by ACP itself) succeed, which is a confusing partial-failure signature.
- The ACP's MCP helper is the `buzz-dev-mcp` binary, NOT the `buzz` CLI (buzz has no MCP mode; spawning it yields "requires a subcommand" and `mcp: init ... connection closed`). It must be built and kept in deploy images.
- Start script runs one ACP worker per public host and registers ACP membership in each host's community.

**Why:** two rounds of silent agent failure were caused by loopback community binding (no events delivered, then replies 403'd). Unset env vars preserve legacy single-tenant behavior.
