---
name: Workspace recovery can silently drop .replit / replit.nix config
description: Replit checkpoint recovery (Pre/Post-Recovery) dropped the [deployment] section from .replit and deleted replit.nix, breaking publishes with "run command required" and pre-build failures
---

# Workspace recovery drops config silently

A Replit "Recovery" checkpoint operation (2026-07-31) silently removed the `[deployment]` section from `.replit` (run + build commands) and deleted `replit.nix`. Symptoms surfaced days later as publish failures: UI error "run command required" and builds dying immediately after "Running Security Scan" with sparse 4-line logs — never reaching package install.

**Why:** Platform checkpoint recovery does not preserve all dotfile config; nothing warns about the loss. The missing `[deployment]` section made every publish fail before compilation, which looked like an infra/security-scan problem and cost a day of misdiagnosis (git-bloat theory, vuln-scan theory).

**How to apply:** After any Recovery checkpoint (or unexplained publish failures that die before "Installing packages"), FIRST diff config: `git log --format='%h %s' -- .replit replit.nix` and check `[deployment]`, `replit.nix`, and other dotfile sections survived. Direct edits to `.replit`/`replit.nix` are blocked — write the full file to a temp path and call `verifyAndReplaceDotReplit`, and restore nix packages via `installSystemDependencies` (never WriteFile). Note: the platform's deploy callbacks (listDeploymentBuilds etc.) and sparse build logs can make config failures look like infra outages.
