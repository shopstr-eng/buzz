---
name: Blossom upload progress & environments
description: Why the web uploader has both an XHR path and a fetch fallback, and a flaky e2e caveat.
---

- The web Blossom uploader uses XMLHttpRequest for progress events + 60s stall abort; a fetch fallback (size-scaled overall timeout) exists because the blossom e2e tests run under `@vitest-environment node`, which has no XMLHttpRequest.
  **Why:** switching wholesale to XHR silently breaks node e2e runs.
  **How to apply:** any change to the upload path must keep both branches working; run the live e2e (`E2E_RELAY_URL`/`E2E_UPLOAD_SECKEY`) to verify.
- The "413 before streaming" video-rejects e2e times out through the dev-domain proxy (it buffers request bodies, so the relay's early 413 never reaches the client). Pre-existing/environmental, not a code regression.
