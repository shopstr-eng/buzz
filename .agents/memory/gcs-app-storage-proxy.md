---
name: GCS App Storage proxy for media
description: How production media storage is wired to Replit App Storage via a Node.js S3-compatible proxy.
---

## What it does

`scripts/gcs-s3-proxy.mjs` is a Node.js process that listens on `http://127.0.0.1:9000` and speaks the S3 path-style XML API that `rust-s3` expects, forwarding all operations to GCS via the Replit sidecar at `127.0.0.1:1106`. This replaces ephemeral MinIO in production deployments (MinIO data would be wiped on every redeploy).

## Replit sidecar endpoints used

| Endpoint | Returns |
|---|---|
| `http://127.0.0.1:1106/object-storage/default-bucket` | `{"bucketId":"<id>"}` — empty string if no bucket provisioned |
| `http://127.0.0.1:1106/credential` | `{"access_token":"<token>","expires_in":3600}` |

**Why:** The sidecar is always running in Replit standard apps. It provides GCS credentials without any manually managed API keys.

## start-replit.sh logic (section 1b)

Priority order when `BUZZ_S3_ENDPOINT` == `http://127.0.0.1:9000` (the default):
1. **Production (`REPLIT_DEPLOYMENT` set)**: Probe sidecar at `:1106`. If reachable → start `gcs-s3-proxy.mjs` on port 9000, set dummy access/secret keys (`gcs_proxy` / `gcs_proxy_secret`). If not reachable → fail boot loudly.
2. **Dev (`REPLIT_DEPLOYMENT` unset)**: Fall through to existing MinIO download+start path. Dev data is ephemeral — intentional.

If `BUZZ_S3_ENDPOINT` is set to something other than `127.0.0.1:9000`, the script leaves it alone and neither proxy nor MinIO starts (operator-supplied S3 bucket used directly).

## Pre-deployment step: provision the bucket

The Replit sidecar returns `{"bucketId":""}` if no App Storage bucket is provisioned. The proxy exits with a clear error in this case. To provision:
1. Open the **App Storage** tool in the Replit editor (Tools → App Storage)
2. Create a new bucket for this repl
3. Redeploy — the proxy will then get a real bucket ID from the sidecar

## Deploy-environment reality check (2026-07-30 publish failure)

The sidecar at 127.0.0.1:1106 serves its HTTP API in the DEV container but NOT in the autoscale deploy container (TCP accepts, HTTP gets "other side closed"). Replit docs say deployments receive GCS credentials automatically for the official SDKs and "you do not need to manually configure sidecars or custom credential endpoints" — the 1106 pattern is unverified/unsupported in deployments. Provisioning the bucket alone may NOT fix the proxy; the durable fix likely requires sourcing credentials the way the official SDK does (deployment-injected env), not from 1106.

**Why:** a publish failed at the promote step because the proxy's `getBucketId` fetch died and the boot script exited 1 — startup probe never got a 200.
**How to apply:** the boot script now falls back to ephemeral MinIO (loud WARNINGs, `_GCS_FALLBACK_MINIO`) instead of failing the publish; media wipes on redeploy until durable storage is restored. Don't extend the 1106 sidecar design for prod without proving it serves in a real deployment first — test in the deploy env, not dev.

## BUZZ_STORAGE_METRICS

Currently set to `"off"` in `.replit`. Can be re-enabled after the production bucket is confirmed working (the storage sweep uses `list_page` which goes through the proxy → GCS list API).

## Proxy implementation notes

- Uses only Node.js built-ins (`http`, `https`, `url`) — no npm dependencies
- Tokens refreshed 5 min before 1h expiry
- Large PUT bodies piped directly to GCS `uploadType=media` without buffering
- GCS metadata HEAD returns `Content-Length` and `ETag` headers as required by `rust-s3`'s `head_object`
- Range GETs (`GET /{bucket}/{key}` with `Range` header) → GCS returns 206, forwarded as-is

**Why:** The relay's Rust code uses `rust-s3` (S3/SigV4), not a GCS SDK. Writing a full GCS Rust backend would require new crate dependencies and recompilation. The proxy speaks S3 on the inside (so no Rust changes) and GCS on the outside (so no new credentials needed).
