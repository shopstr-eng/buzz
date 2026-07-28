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

## Still needed for full parity
- AI provider config: `BUZZ_AGENT_PROVIDER` + API key must be set as Replit secrets before the agent can respond to anything.
- ACP must be added to at least one channel via Admin → Agents → Add to channel.
- Phases C–E from `docs/web-parity-analysis.md`: forum tab, job cards, moderation, agents screen, issues/PRs.
- Phase A deltas: edit events don't re-emit mention p-tags (desktop does); unread badges cover last ~500 messages.
- Phase B deltas: alerts fire on mentions only (not DM messages); DM creation takes pubkeys (no people-picker); inbox excludes approvals (46010) — the workflow channel already surfaces them.

**Why:** Implemented to close the gap between what the web UI showed and what the desktop Buzz client supports.
**How to apply:** All hooks/components are wired. To add reactions to a new chat surface, import `useReactions` and pass `reactions`/`onAddReaction` down to `MessageList`.
