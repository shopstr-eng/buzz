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
- **buzz-cli built + wired as MCP server** — `cargo build -p buzz-cli --release` succeeded. `BUZZ_ACP_MCP_COMMAND` in `start-replit.sh` defaults to `target/release/buzz-cli`, giving the ACP agent `buzz messages send`, `buzz workflows list`, etc. as tools.

## ACP agent control commands (NOT slash commands)
The ACP monitors kind:9 for `!rotate`, `!cancel`, `!shutdown` from the owner pubkey. These are `!` prefix, not `/` prefix. The `/` slash commands in `MessageComposer` are user prompts forwarded to the LLM agent as content.

## Still needed for full parity
- AI provider config: `BUZZ_AGENT_PROVIDER` + API key must be set as Replit secrets before the agent can respond to anything.
- ACP must be added to at least one channel via Admin → Agents → Add to channel.
- No emoji picker beyond the 6 quick-react emojis (full picker is a separate feature).
- No notification badge for unread reactions.

**Why:** Implemented to close the gap between what the web UI showed and what the desktop Buzz client supports.
**How to apply:** All hooks/components are wired. To add reactions to a new chat surface, import `useReactions` and pass `reactions`/`onAddReaction` down to `MessageList`.
