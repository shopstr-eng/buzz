---
name: Git identity policy for main
description: User requires main to carry their GitHub identity; task-agent merges and platform checkpoints arrive under Replit-managed identities and must be rewritten before pushing; GITHUB_TOKEN auth quirks
---

# Git identity policy

Main must be authored/committed as `calvadev⚡️ <32919103+calvadev@users.noreply.github.com>` before pushing to origin (github.com/shopstr-eng/buzz). Replit-managed identities that appear in history and must be rewritten:
- `20519411-calvadev@users.noreply.replit.com` (task-agent merges)
- `agent@replit.com` (platform checkpoints, "Published your App")
- `replit-agent@users.noreply.github.com` (older agent sessions)

**Why:** User explicitly requested (2026-07-31) that commits be "reauthorized using my github identity and access token, not the replit managed identity" after ~45 task-agent merge commits landed under the Replit identity.

**How to apply:** Local `git config user.name/email` in the main workspace is already set to the GitHub identity, but task-agent isolated environments commit under the Replit identity regardless — so re-check authorship after any task-agent merge batch (`git log --format='%ae' | grep -E 'replit'`) before pushing. Rewrite with a conditional `filter-branch --env-filter` scoped to the range being pushed (match all three emails, author AND committer), then `push --force-with-lease`. As of the 2026-07-31 rewrite, 6 older managed-identity commits pre-dating the batch remain in published history by user's scoping ("latest commits" only).

# GITHUB_TOKEN auth quirk

`git -c http.extraHeader="Authorization: Bearer $GITHUB_TOKEN" fetch` FAILS ("Authentication failed") even though the same Bearer header gets 200 from api.github.com. Embedding works: `git fetch/push "https://x-access-token:${GITHUB_TOKEN}@github.com/shopstr-eng/buzz.git" main`. No credential helper is configured. Token is a classic PAT.
