---
name: Web UI parity gaps
description: What was implemented and what still remains vs the desktop Buzz app
---

## Implemented (this session)

- **Emoji reactions** — `use-reactions.ts` subscribes to kind:7 `#h:[groupId]`. `MessageRow` shows reaction chips + hover quick-react picker (6 emoji palette). `addReaction` publishes kind:7 with `["e", messageId]` + `["h", groupId]` tags.
- **Reply threading** — `MessageRow` renders an inline quote block when `replyToMessage` is set. `MessageList` builds `messagesById` map and passes context. `MessageComposer` shows a dismissable reply-to banner. `ChannelView` manages `replyTo` state. `useSendMessage` already had `["e", replyToId, "", "reply"]` tag support.
- **Slash command hints** — `MessageComposer` detects `/` prefix and shows a picker with `/run`, `/review`, `/help`, `/approve`, `/cancel`, `/summary`. Works alongside `@` mention picker.
- **Workflow channel chat** — `WorkflowChannelView` gained a "Chat" tab (via `AgentChatPanel` inner component) using `useMessages` + `useSendMessage` + `useReactions` + `MessageList` + `MessageComposer`. Has a banner nudging users to @mention agents and use slash commands.
- **Historical workflow runs** — `use-workflow-runs.ts` split into a history subscription (`until: now, limit: 500`, self-closing after EOSE) + live subscription (`since: now`). Previously only live events were visible.
- **buzz-cli built + wired as MCP server** — `cargo build -p buzz-cli --release` succeeded. The crate is `buzz-cli` but it produces binary `target/release/buzz` (not `buzz-cli`). `BUZZ_ACP_MCP_COMMAND` in `start-replit.sh` defaults to `target/release/buzz`. `build_rust_bin_if_missing buzz buzz-cli` is called at script top.

## ACP agent control commands (NOT slash commands)
The ACP monitors kind:9 for `!rotate`, `!cancel`, `!shutdown` from the owner pubkey. These are `!` prefix, not `/` prefix. The `/` slash commands in `MessageComposer` are user prompts forwarded to the LLM agent as content.

## Full parity analysis
A complete desktop↔web gap analysis (per-feature tables + phasing A–E) lives at `docs/web-parity-analysis.md` (2026-07-27). Update it as gaps close.

## Phase A done (2026-07-27) — key decisions
- **Self-delete publishes kind 5** (not 9005) with `h+e` tags — matches desktop; 9005 is the moderation variant. Relay accepts both for ingest.
- **Read state + pinned channels are web-local (localStorage)** — desktop's kind:30078 NIP-RS format is nip44-encrypted slot-merged blobs; cross-client sync is a follow-up, do NOT publish plaintext 30078 (would collide with desktop's blobs).
- **Optimistic edits tracked in a set** — relay echo must always replace an optimistic edit regardless of clock skew (timestamp-compare only applies to confirmed edits).
- Presence uses tab-visibility (web has no OS idle); user status kind 30315 d-tag `general`.

## Phase B done (2026-07-27) — key decisions
- **DMs are kind 41010 open + p tags** (relay idempotent participant-hash channels surfaced as kind:39000 `t=dm` with `p` tags) — desktop's Tauri `open_dm` maps to the same relay command; no NIP-04/1059 anywhere.
- **Reminders need NIP-44**: nsec login works locally; NIP-07 requires `window.nostr.nip44` (extension-optional) — gate features on `getNip44SelfAsync()`.
- **Live-alert subscriptions must not depend on route state** — key the effect on connection/identity only and track pathname in a ref, or mentions get dropped in the teardown window on navigation.
- **Replaceable-event ingestion: re-check d-tag version AFTER async decrypt** — older event finishing decrypt later must not overwrite newer state.
- **Virtual route config**: `web/src/app/routes.ts` is the source of truth — new route files are ignored until registered there (routeTree won't regenerate otherwise).

## Phase C done (2026-07-27) — key decisions
- **Reports (1984) suppress relay fanout** — the relay persists them to `moderation_reports` but never fans out, so a web mod queue is impossible via subscription (desktop uses Tauri API). Web implements report submission + 9040–9043 commands only.
- **publishAndWait emits EVENT itself** — never call `connection.publish()` and `publishAndWait()` on the same event (double-send). Use publishAndWait alone and roll back optimistic rows on rejection.
- **Mixed-kind subscriptions deliver out of order** — aggregation across kinds (forum posts+comments) must cache children until parents arrive and dedupe by event id.
- **Moderation commands are community-scoped (no h tag)** — tag shapes pinned by desktop `shared/api/moderation.ts`: timeout 9042 requires `["expiration", ts]`; timeout detection is reactive via OK false `restricted: you are timed out until <ts>`.

## Phase D done (2026-07-27) — key decisions
- **NIP-AM 44200 payloads are camelCase** (`turn.inputTokens/costUsd` — serde rename_all), NIP-44-encrypted to the owner with the agent pubkey in the `agent` tag; the counts field is `payload.turn` (null when delta_reliable is false).
- **Observer 24200 frames are owner-scoped (#p), never h-tagged** — web can't associate them with channels beyond the envelope's `channel_id` field. Subscription mirrors desktop: `#p=[owner]`, 300s lookback.
- **Persona/team snapshots (30175/30176/30177) are backend-published read-only mirrors** — web displays them; creation stays desktop/admin. Compare created_at for latest-wins, not arrival order.
- **js-yaml has no default export under rolldown** — use named imports `{ load, dump }`.

## Phase E done (2026-07-27) — key decisions
- **NIP-34 trust rule: root author or repo owner only** — status events (1630–1633) AND PR updates (1619) from any other signer must be ignored; the relay does not enforce this (desktop filters client-side via trustedUpdatesForPullRequest).
- **Same-second lifecycle writes race on delivery order** — resolve ties deterministically (larger event id wins) and publish status events with monotonic created_at (last known + 1).
- **clone tags can be multi-value** — parse tag.slice(1), not tag[1].
- **PR/issue merge is impossible from web** — desktop merges via Tauri git command; web exposes close/reopen/draft/done only.

## Still needed for full parity
- AI provider config: DONE — start script maps AI_INTEGRATIONS_ANTHROPIC_API_KEY → ANTHROPIC_API_KEY and defaults BUZZ_AGENT_PROVIDER=anthropic.
- ACP channel membership: DONE in dev (agents channel, ACP joined, turns verified). Prod community (buzz.shopstrmarkets.com) needs the same join per channel if agents are wanted there.
- Agents tab creation: DONE on web (personas/teams/managed agents, full create/edit/delete mirroring desktop's write contract in `web/src/features/agents/agent-events.ts` — keep builders and `desktop/src-tauri/src/managed_agents/*_events.rs` in lockstep after upstream merges). Replaceable resolution for the directory lives in `directory-store.ts` and must match relay semantics everywhere: newest created_at wins, same-second ties go to the larger event id, and kind-5 tombstones suppress snapshots at/below the delete's timestamp (replay can deliver a delete before the older snapshot it removes). Web edits of desktop-authored records must preserve contract fields the web UI doesn't expose (name_pool, parallelism, respond_to_allowlist) — passthrough, don't drop. Deletions are kind-5 address-only; use-agents.ts applies them live. Managed-agent creation generates a keypair and shows the nsec once (web never stores it); running the agent still needs the key provisioned to an ACP worker. Usage (44200) publishes only when the agent backend emits a usage notification AND delta is reliable — buzz-agent can skip emission (lib.rs "nothing correct to emit"), then the section stays empty with no error. Live activity (24200) frames are ephemeral and only visible live while the tab is open; lookback never returns history.
- Phases D–E from `docs/web-parity-analysis.md`: agents screen depth, workflow trace viewer, issues/PRs.
- Phase A deltas: edit events don't re-emit mention p-tags (desktop does); unread badges cover last ~500 messages.
- Phase B deltas: alerts fire on mentions only (not DM messages); DM creation takes pubkeys (no people-picker); inbox excludes approvals (46010) — the workflow channel already surfaces them.
- Phase C deltas: no 45002 forum votes; no mod queue (see above); job cards are labeled rows without state aggregation; templates are web-local. Unban (9041)/untimeout (9043) ARE wired in the message context menu — shown unconditionally to moderators since web has no ban/timeout state tracking.
- Mention browser notifications navigate to the channel on click (Notification.onclick + window.focus).

**Why:** Implemented to close the gap between what the web UI showed and what the desktop Buzz client supports.
**How to apply:** All hooks/components are wired. To add reactions to a new chat surface, import `useReactions` and pass `reactions`/`onAddReaction` down to `MessageList`.
