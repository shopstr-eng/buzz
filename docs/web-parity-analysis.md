# Web ↔ Desktop Parity Analysis

Generated 2026-07-27. Compares `desktop/` (Tauri reference client) against `web/` (this project's web client).
Legend: ✅ full parity · 🟡 partial · ❌ missing · 🖥️ desktop-native (Tauri-only, no realistic web parity)

---

## 1. Core chat (channels / messages / composer)

| Capability | Desktop | Web | Status | Gap to close |
|---|---|---|---|---|
| Message timeline | `MessageTimeline`, grouping, virtualized | `MessageList`/`MessageRow`, grouping, pending state | ✅ | — |
| Mentions | `@` picker, agents included | ✅ same | ✅ | — |
| Slash commands | `/run` `/review` `/help` `/approve` `/cancel` `/summary` | ✅ same | ✅ | — |
| Reply threading | Thread panel (`MessageThreadPanel`, `FocusThreadDrawer`) + inline quotes | Inline quote + reply banner only | 🟡 | Full thread drawer/panel: click a reply to open the whole thread in a side panel |
| Reactions | Kind 7, full emoji picker + NIP-30 custom emoji | Kind 7, 6-emoji quick-react palette | 🟡 | Full emoji picker; custom (NIP-30) emoji support |
| Message edits | Kinds 40003/40008 (edits/diffs), "edited" marker | Not rendered | ❌ | Subscribe 40003/40008, show edited state + edit own messages |
| Message deletion | Kinds 5/9005, removed in UI with tombstone | Not handled | ❌ | Subscribe 5/9005, tombstone or remove; delete-own action |
| Message context menu | Copy, reply, react, edit, delete, pin, report, timeout (mod) | Hover quick-react only | ❌ | Right-click/long-press menu per message |
| Read state / unread | Kind 30078 read state, unread badges in sidebar | None | ❌ | Publish read state; unread badge per channel; mention badge |
| Typing indicators | Per-channel typing indicator | None | ❌ | Typing indicator subscription/publish |
| System messages | Kind 40099 (member joined, etc.) | Not rendered | ❌ | Render 40099 in timeline |
| Channel canvas | `ChannelCanvas` | None | ❌ | Canvas tab/section in channel view |
| Jobs in channel | Kinds 43001–43006 (job cards) | None | ❌ | Render job events in timeline |
| Pins / stars / mutes / sections | Sidebar kinds 30078 (sections, mutes, stars, sort) | Plain channel list | ❌ | Pinned channels, mute, custom sections, sort order |
| Channel settings | Permissions, typing, template application | Create dialog only | ❌ | Channel settings dialog (rename, permissions) |
| Channel templates | `channel-templates` (create/duplicate/apply) | None | ❌ | Template picker in create-channel flow |
| Forum view | Threaded forum per channel: posts (45001), comments (45003), route `/channels/$id/posts/$postId` | None | ❌ | Forum tab per channel + post detail route |

## 2. Agents

| Capability | Desktop | Web | Status | Gap |
|---|---|---|---|---|
| Add agent to channel | ✅ | `ConnectAgentDialog` (kind 10100) | ✅ | — |
| Agent profiles | Kind 10100 + persona/team snapshots 30175/30176 | 10100 only | 🟡 | Persona/team rendering |
| Create/configure agents | `AgentsScreen`: models, API keys, MCP servers | None (admin-web partial) | ❌ | Agents management screen |
| Session transcripts | `AgentSessionTranscriptList` | None | ❌ | Transcript viewer |
| Turn metrics | Kind 44200 | None | ❌ | Metrics display |
| Observer frames | Kind 24200 | None | ❌ | Live "agent is working" frames in channel |
| Memory graph | `MemorySection` (decrypted engrams, owner-only) | None | ❌ | Memory visualization (owner-only) |
| Import/export snapshots | ✅ | None | ❌ | Snapshot import/export |

## 3. Navigation & app shell

| Capability | Desktop | Web | Status | Gap |
|---|---|---|---|---|
| Views | Home, Pulse, Agents, Projects, Workflows, Reminders, Settings | Channels, Repos only | ❌ | See §4–§8 |
| Community switcher | Multi-relay rail, add/reorder communities | Single-relay (host-bound) | 🖥️/❌ | Web is host-bound by design; skip multi-relay, but a "community" home page is still missing |
| Global search | `TopbarSearch` + `ChannelFindBar`, jump to message/post | None | ❌ | Global search (users/channels/messages) + in-channel find bar |
| Unread badges | Sidebar badges, sounds, desktop notifications | None | ❌ | Unread/mention badges (needs read state) |
| New DM | `/messages/new`, kind 4/1059 DMs | None | ❌ | DM support (list + compose + route) |
| Back/forward history | Global nav history (deep links, drawers) | Browser default | 🟡 | Fine for web; ensure deep links work |

## 4. Home / Pulse / Notifications / Reminders

| Capability | Desktop | Web | Status | Gap |
|---|---|---|---|---|
| Home inbox | Aggregates messages, reminders, approvals (46010), jobs | None | ❌ | Home/inbox route aggregating mentions, approvals, reminders |
| Pulse | Activity feed (repo + agent activity), tab bar | None | ❌ | Pulse route with activity cards |
| Notifications | Settings card, sound picker, badges | None | ❌ | Web notifications + sound; settings section |
| Reminders | Panel, snooze, kinds 30300/40007 | None | ❌ | Reminders panel + "remind me" action on messages |
| Approvals | Approval cards in Home + workflows | Grant/deny in workflow runs only | 🟡 | Surface approvals in inbox/home |

## 5. Presence, profile, identity

| Capability | Desktop | Web | Status | Gap |
|---|---|---|---|---|
| Presence | Kind 20001, badges, idle detection | Implicit activity only | ❌ | Publish/subscribe 20001; online/away dots on avatars |
| User status | Kind 30315 custom text/emoji status | None | ❌ | Set-status dialog; render status next to names |
| Profile popover | Hover card on any avatar | None | ❌ | Profile popover (avatar, name, status, DM button) |
| Profile edit | Avatar upload, animated avatars, colors, personas | `ProfileEditDialog` basic | 🟡 | Avatar upload (media), banner/colors |
| Contact list | Kind 3 follows | None | ❌ | Optional; low priority for chat parity |
| Onboarding | Multi-step wizard, key backup, invite redeem | Login + invite page | 🟡 | Adequate for web; key-backup nudge optional |
| Identity archive | 13535 snapshots | None | 🖥️ | Skip |

## 6. Moderation

| Capability | Desktop | Web | Status | Gap |
|---|---|---|---|---|
| Report message | Dialog, kind 1984 | None | ❌ | Report action in message menu |
| Timeout/ban | Kinds 9040–9043, duration submenu | None | ❌ | Mod actions (role-gated) |
| Mod queue | `ModerationQueueCard`, resolve 9044 | None | ❌ | Mod queue panel (admins/mods) |
| Timeout banner | `ComposerTimeoutBanner` when restricted | None | ❌ | Composer restriction state |

## 7. Workflows

| Capability | Desktop | Web | Status | Gap |
|---|---|---|---|---|
| Definitions | Visual form builder (`WorkflowFormBuilder`) | YAML editor | 🟡 | Visual form builder (or keep YAML — decide UX direction) |
| Runs | Run cards + **trace viewer** | Live status logs | 🟡 | Run trace viewer (step-by-step) |
| Chat tab | — | ✅ (web added) | ✅ | Web is ahead here |
| Historical runs | — | ✅ (web added) | ✅ | Web is ahead here |
| Webhook headers | Editor in builder | None | ❌ | Advanced; include with form builder |
| Approvals | Cards | Grant/deny buttons | 🟡 | Richer approval cards |

## 8. Projects / repos

| Capability | Desktop | Web | Status | Gap |
|---|---|---|---|---|
| Repo list/detail | ✅ | ✅ (tree, blob, commits, README) | ✅ | — |
| Issues | Kind 1621, create dialog | None | ❌ | Issues tab per repo |
| Pull requests | Kind 1618, merge buttons | None | ❌ | PRs tab per repo |
| Patches | Kind 1617 | None | ❌ | Patch rendering |
| Status (CI) | Kinds 1630–1633 | None | ❌ | Status badges on commits/PRs |
| Diff viewer | Commit diff view | None | ❌ | Diff view in commit history |
| Contribution graph | ✅ | None | ❌ | Optional polish |

## 9. Settings

| Capability | Desktop | Web | Status | Gap |
|---|---|---|---|---|
| Settings screen | Sectioned rail: profile, notifications, sounds, shortcuts, experimental | Theme toggle only | ❌ | Settings route with sections |
| Custom emoji | NIP-30 sets (30030) management | None | ❌ | Emoji settings + picker integration |
| Sounds | Sound picker | None | ❌ | With notifications |
| Keyboard shortcuts | ✅ | None | ❌ | Basic set (send, search focus, reply) |

## 10. Desktop-native (no full web parity)

| Capability | Why |
|---|---|
| Voice huddle (48100–48103, STT/TTS) | Native audio pipeline in Tauri. WebRTC partial parity is a large separate project — recommend explicit "desktop only" or a much later phase. |
| OS tray, idle detection, prevent-sleep | Native APIs. Browser has Page Visibility only — approximate "away" from tab focus. |
| Managed agents (local runtime, screenshots, shell) | Runs on the user's machine; web uses relay-side ACP agents instead (already covered). |
| Mesh compute, local archive | Local resource sharing / offline archive — desktop concepts. |
| Keyring/secure enclave key storage | Web uses NIP-07 extension or key entry (already implemented). |
| Deep links (`buzz://`) | Web equivalent is normal URLs — already true. |

---

## Recommended phasing for the web client

**Phase A — chat completeness (highest user-visible parity value)** — ✅ DONE (2026-07-27)
1. ✅ Message edits (40003) + deletions (kind 5, same h/e tag shape as desktop) with hover menu
2. ✅ Message context menu (copy/edit/delete/open-thread; report/pin-message not yet)
3. ✅ Full emoji picker (+ NIP-30 custom emoji: kind 30030 d-tag `buzz:custom-emoji`, `["emoji", shortcode, url]` reaction tags, `:shortcode:` rendering in content + reaction chips)
4. ✅ Read state → unread + mention badges in sidebar — **web-local v1** (localStorage); desktop's encrypted NIP-RS slot format (kind 30078, nip44-to-self) sync is a follow-up
5. ✅ Typing indicators (kind 20002, 3s throttle, 8s TTL, cleared on message)
6. ✅ System messages (40099): join/leave/channel-created/moderation tombstones as centered rows
7. ✅ Pinned channels with sidebar section — **web-local v1** (localStorage); kind-30078 sync + custom sections/drag-sort are follow-ups
8. ✅ Presence (20001; tab-visibility heartbeat — desktop uses OS idle) + user status (30315, d=`general`) + profile popover (avatar/name/presence/status/about)
9. ✅ Thread panel drawer (reply-chain discovery, in-thread composer, "Open thread" menu action)
10. ✅ Channel settings dialog (kind 9002 name/about edit; relay enforces permissions)

_Known deltas:_ edited messages don't re-emit mention `p` tags / NIP-30 overlay tags (desktop does); unread badges cover the last ~500 community messages.

**Phase B — app shell**
1. Global search + in-channel find bar
2. Home/inbox (mentions, approvals, reminders) + Pulse feed
3. Notifications + sounds + settings screen (sections)
4. DMs (kind 4/1059) + `/messages/new` equivalent
5. Reminders panel + "remind me" message action

**Phase C — channel extensions**
1. Forum tab per channel (45001/45003) + post route
2. Channel canvas
3. Job cards (43001–43006) in timeline
4. Moderation: report/timeout/ban/mod queue + composer timeout banner
5. Channel templates

**Phase D — agents & workflows depth**
1. Agents screen: personas/teams (30175/30176), transcripts, metrics (44200), observer frames (24200) in channel
2. Workflow run trace viewer; visual form builder (or keep YAML by decision)
3. Webhook header editor

**Phase E — projects depth**
1. Issues (1621), PRs (1618), patches (1617), CI status (1630–1633)
2. Diff viewer; contribution graph (optional)

**Explicitly out of scope for web:** voice huddle, tray/idle/prevent-sleep, managed local agents, mesh compute, local archive (desktop/Tauri-only).

---

## Notes
- `admin-web` already covers relay-level administration (agents, channels, members, providers). Keep admin functions there; this analysis concerns the *user-facing* client.
- Web is **ahead of desktop** in: workflow channel chat tab, historical workflow runs.
- Event-kind coverage summary: web currently handles 0, 5(part), 7, 9, 10100, 30617, 30620, 39000, 39002, 40002, 44100/44101, 46001–46031. Desktop additionally uses 1, 3, 4/1059, 1617/1618/1621, 1630–1633, 1984, 20001, 24200, 24810, 30030, 30078, 30175–30177, 30300, 30315, 30618, 39005, 40003, 40007, 40008, 40099, 43001–43006, 44100-series (notif), 44200, 45001/45003, 46010, 48100–48103, 9000/9001, 9005, 9040–9044, 13535.
