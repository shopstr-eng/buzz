---
name: NIP-46/NIP-49 web sign-in
description: Decisions behind the remote-signer (bunker) and ncryptsec login options in the Buzz web app, plus nostr-tools test-harness quirks in this environment.
---

## Feature decisions (2026-07-29)

- **NIP-46 session = `sessionStorage["buzz_nip46_v1"]` = { input, clientSecretKey }** — `input` is the original bunker:// URI or NIP-05 address; the disposable client keypair is generated per login and deleted on logout. The user key never enters the app (all sign/encrypt ops are RPC over kind:24133).
- **Restore is lazy**: `getSignFn()` returns null when no session is stored (RelayProvider's existing null-signFn path forces re-login); `ensureNip46Signer()` reconnects on first use. If restore *rejects* (bunker unreachable 45s, bad stored input), the sign closure calls `clearIdentity()` + `window.location.reload()` — deliberate, to avoid wedging behind a dead signer.
- **ncryptsec is decrypted at login and becomes a plain nsec session** — password is NFKC-normalized, never stored; identity type stays `"nsec"`. No ncryptsec export/encrypt UI exists (decrypt-only scope).
- **nostrconnect:// flow NOT implemented** — bunker://-paste only. Adding nostrconnect means QR/display UX + waiting state; nostr-tools `createNostrConnectURI` is available if requested.
- NIP-44 helpers proxy to the bunker via `ensureNip46Signer()` — every nip44 encrypt/decrypt is a network round trip; latency on first use after reload includes the reconnect handshake.

**Why:** upstream has no web NIP-46/NIP-49; these choices keep the fork's three-method sign-in (nip07/nsec/nip46) consistent with sessionStorage-lifetime credentials.

**How to apply:** after upstream merges touching `web/src/shared/lib/identity.ts` or `relay-context.tsx`, re-check the `IdentityType` union ("nip07"|"nsec"|"nip46"), the getSignFn nip46 branch, and the relay-context `loginWithBunker` wiring survive.

## nostr-tools harness quirks (this environment)

- **Node 20 has no global WebSocket** — any node-side nostr-tools script needs `node --experimental-websocket` PLUS `useWebSocketImplementation(WebSocket)` from `nostr-tools/pool`, else SimplePool hangs silently (no error, just never connects). Even with both, BunkerSigner client-side publishes stalled against public relays from this container; browser-side (native WebSocket) is the reliable e2e target.
- **The relay content-negotiates at `/`**: plain curl gets the NIP-11 JSON doc, not the SPA. Add `-H "Accept: text/html"` to verify which web bundle is served.
