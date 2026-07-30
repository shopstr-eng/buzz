#!/usr/bin/env node
/**
 * gcs-s3-proxy.mjs
 *
 * A minimal S3-compatible HTTP proxy that stores objects in Replit App Storage
 * (Google Cloud Storage). Listens on 127.0.0.1:9000 and speaks the S3 path-style
 * XML API that the rust-s3 crate uses, forwarding all operations to GCS via the
 * Replit sidecar at 127.0.0.1:1106.
 *
 * This replaces the ephemeral MinIO server in production Replit deployments where
 * .minio-data would be wiped on every redeploy. The sidecar provides GCS
 * credentials without any manually managed API keys.
 *
 * Implemented endpoints (path-style: /{bucket}/{key}):
 *   PUT  /{bucket}            → 200 OK (noop; GCS bucket already exists)
 *   PUT  /{bucket}/{key}      → upload object to GCS
 *   GET  /{bucket}/{key}      → download object from GCS (Range supported → 206)
 *   HEAD /{bucket}/{key}      → object metadata (Content-Length, ETag)
 *   DELETE /{bucket}/{key}    → delete object from GCS
 *   GET  /{bucket}?list-type=2 → list objects (returns S3 XML)
 *
 * Uses only Node.js built-ins (http, https, net) — no npm packages required.
 *
 * Auth: tokens are fetched from the Replit sidecar and refreshed 5 minutes
 * before expiry (GCS tokens are valid for 1 hour).
 */

import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const LISTEN_PORT = parseInt(process.env.GCS_PROXY_PORT || '9000', 10);
const LISTEN_HOST = '127.0.0.1';
const SIDECAR_BASE = 'http://127.0.0.1:1106';
const GCS_API_BASE = 'https://storage.googleapis.com';

// ---------------------------------------------------------------------------
// Token management
// ---------------------------------------------------------------------------
let _token = null;
let _tokenExpiresAt = 0; // ms epoch

async function getToken() {
  const now = Date.now();
  // Refresh 5 minutes before expiry
  if (_token && now < _tokenExpiresAt - 5 * 60 * 1000) {
    return _token;
  }
  const resp = await fetch(`${SIDECAR_BASE}/credential`);
  if (!resp.ok) {
    throw new Error(`Sidecar /credential returned ${resp.status}`);
  }
  const data = await resp.json();
  _token = data.access_token;
  // GCS tokens last 3600 s; sidecar may not send expiry, so assume 1 hour.
  const expiresIn = (data.expires_in ?? 3600) * 1000;
  _tokenExpiresAt = now + expiresIn;
  return _token;
}

// ---------------------------------------------------------------------------
// Bucket ID from sidecar (resolved once at startup, stored in module state)
// ---------------------------------------------------------------------------
let _bucketId = null;

async function getBucketId(nameFromPath) {
  // If the caller already has a bucket name from the URL path, use it as the
  // GCS bucket name directly (set by start-replit.sh via BUZZ_S3_BUCKET).
  // The sidecar's default-bucket is authoritative for the Replit-provisioned
  // bucket; the env var name must match.
  if (_bucketId) return _bucketId;
  const resp = await fetch(`${SIDECAR_BASE}/object-storage/default-bucket`);
  if (!resp.ok) {
    throw new Error(`Sidecar /object-storage/default-bucket returned ${resp.status}`);
  }
  const data = await resp.json();
  if (!data.bucketId) {
    throw new Error(
      'No App Storage bucket is provisioned for this Repl. ' +
      'Open the App Storage tool in the Replit editor, create a bucket, ' +
      'and redeploy. Alternatively, set BUZZ_S3_ENDPOINT / BUZZ_S3_ACCESS_KEY / ' +
      'BUZZ_S3_SECRET_KEY / BUZZ_S3_BUCKET as production secrets to use an ' +
      'external S3-compatible bucket.',
    );
  }
  _bucketId = data.bucketId;
  console.error(`[gcs-s3-proxy] GCS bucket: ${_bucketId}`);
  return _bucketId;
}

// ---------------------------------------------------------------------------
// GCS JSON API helpers
// ---------------------------------------------------------------------------

// Make a GCS API request, returning the raw http.ClientRequest response.
// For streaming downloads the response is piped by the caller.
function gcsRequest({ method, path, headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const url = new URL(GCS_API_BASE + path);
    const opts = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname + url.search,
      method,
      headers: {
        ...headers,
        // Authorization injected after token fetch; callers must pass it.
      },
    };
    const req = https.request(opts, resolve);
    req.on('error', reject);
    if (body) {
      if (typeof body.pipe === 'function') {
        body.pipe(req);
      } else {
        req.end(body);
      }
    } else {
      req.end();
    }
  });
}

async function authHeaders() {
  const token = await getToken();
  return { Authorization: `Bearer ${token}` };
}

// Drain a response body to a string.
function readBody(res) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    res.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// S3 XML helpers
// ---------------------------------------------------------------------------
function s3Error(code, message) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Error><Code>${code}</Code><Message>${message}</Message></Error>`;
}

function s3ListResult({ bucket, prefix, items, nextToken, isTruncated }) {
  const contents = items
    .map(
      (o) =>
        `<Contents>` +
        `<Key>${xmlEscape(o.key)}</Key>` +
        `<Size>${o.size}</Size>` +
        `<ETag>"${o.etag || ''}"</ETag>` +
        `<LastModified>${o.updated || new Date().toISOString()}</LastModified>` +
        `<StorageClass>STANDARD</StorageClass>` +
        `</Contents>`,
    )
    .join('');
  const nextToken_ = nextToken
    ? `<NextContinuationToken>${xmlEscape(nextToken)}</NextContinuationToken>`
    : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Name>${xmlEscape(bucket)}</Name>
  <Prefix>${xmlEscape(prefix || '')}</Prefix>
  <IsTruncated>${isTruncated}</IsTruncated>
  ${nextToken_}
  ${contents}
</ListBucketResult>`;
}

function xmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Request router
// ---------------------------------------------------------------------------
async function handleRequest(req, res) {
  const { method, url: rawUrl, headers } = req;

  // Parse path: /{bucket}/{key...}
  const urlObj = new URL(rawUrl, `http://${LISTEN_HOST}:${LISTEN_PORT}`);
  const parts = urlObj.pathname.split('/').filter(Boolean);
  const bucketName = parts[0] || '';
  const objectKey = parts.slice(1).join('/');

  try {
    if (!bucketName) {
      res.writeHead(400);
      res.end(s3Error('InvalidRequest', 'Missing bucket name'));
      return;
    }

    // Resolve the GCS bucket ID (may differ from the S3 bucket name in the URL).
    // We use the Replit-provisioned bucket regardless of the S3 bucket name.
    const gcsBucket = await getBucketId(bucketName);
    const auth = await authHeaders();

    // -----------------------------------------------------------------------
    // PUT /{bucket} — bucket creation (noop: GCS bucket already provisioned)
    // -----------------------------------------------------------------------
    if (method === 'PUT' && !objectKey) {
      // Drain body so the client doesn't hang.
      req.resume();
      res.writeHead(200);
      res.end();
      return;
    }

    // -----------------------------------------------------------------------
    // PUT /{bucket}/{key} — upload object
    // -----------------------------------------------------------------------
    if (method === 'PUT' && objectKey) {
      const contentType = headers['content-type'] || 'application/octet-stream';
      const encodedKey = encodeURIComponent(objectKey);

      // Use the GCS JSON API multipart/media upload.
      // We pipe the incoming HTTP body straight to GCS without buffering.
      const uploadUrl = new URL(
        `/upload/storage/v1/b/${encodeURIComponent(gcsBucket)}/o` +
          `?uploadType=media&name=${encodedKey}`,
        GCS_API_BASE,
      );
      const gcsRes = await new Promise((resolve, reject) => {
        const opts = {
          hostname: uploadUrl.hostname,
          port: 443,
          path: uploadUrl.pathname + uploadUrl.search,
          method: 'POST',
          headers: {
            ...auth,
            'Content-Type': contentType,
            // Forward Content-Length if the client sent it so GCS can validate.
            ...(headers['content-length']
              ? { 'Content-Length': headers['content-length'] }
              : {}),
          },
        };
        const gReq = https.request(opts, resolve);
        gReq.on('error', reject);
        req.pipe(gReq);
      });

      const body = await readBody(gcsRes);
      if (gcsRes.statusCode < 200 || gcsRes.statusCode >= 300) {
        console.error(`[gcs-s3-proxy] PUT ${objectKey}: GCS ${gcsRes.statusCode}`, body.slice(0, 300));
        res.writeHead(500);
        res.end(s3Error('InternalError', `GCS upload failed: ${gcsRes.statusCode}`));
        return;
      }

      // Return ETag from GCS response (it's the MD5 of the object).
      let etag = '';
      try {
        const obj = JSON.parse(body);
        etag = obj.etag || obj.md5Hash || '';
      } catch (_) {}
      res.writeHead(200, { ETag: `"${etag}"` });
      res.end();
      return;
    }

    // -----------------------------------------------------------------------
    // GET /{bucket}/{key} — download object (with Range support)
    // -----------------------------------------------------------------------
    if (method === 'GET' && objectKey && !urlObj.searchParams.has('list-type')) {
      const encodedKey = encodeURIComponent(objectKey);
      const downloadPath =
        `/storage/v1/b/${encodeURIComponent(gcsBucket)}/o/${encodedKey}?alt=media`;

      const extraHeaders = {};
      if (headers['range']) {
        extraHeaders['Range'] = headers['range'];
      }

      const gcsRes = await gcsRequest({
        method: 'GET',
        path: downloadPath,
        headers: { ...auth, ...extraHeaders },
      });

      if (gcsRes.statusCode === 404) {
        res.writeHead(404);
        res.end(s3Error('NoSuchKey', 'The specified key does not exist.'));
        return;
      }
      if (gcsRes.statusCode < 200 || gcsRes.statusCode >= 300) {
        const body = await readBody(gcsRes);
        console.error(`[gcs-s3-proxy] GET ${objectKey}: GCS ${gcsRes.statusCode}`, body.slice(0, 300));
        res.writeHead(gcsRes.statusCode === 416 ? 416 : 500);
        res.end(s3Error('InternalError', `GCS returned ${gcsRes.statusCode}`));
        return;
      }

      const statusCode = gcsRes.statusCode === 206 ? 206 : 200;
      const forwardHeaders = {};
      for (const h of [
        'content-type',
        'content-length',
        'content-range',
        'etag',
        'last-modified',
        'accept-ranges',
      ]) {
        if (gcsRes.headers[h]) forwardHeaders[h] = gcsRes.headers[h];
      }
      res.writeHead(statusCode, forwardHeaders);
      gcsRes.pipe(res);
      return;
    }

    // -----------------------------------------------------------------------
    // HEAD /{bucket}/{key} — object metadata
    // -----------------------------------------------------------------------
    if (method === 'HEAD' && objectKey) {
      const encodedKey = encodeURIComponent(objectKey);
      const metaPath =
        `/storage/v1/b/${encodeURIComponent(gcsBucket)}/o/${encodedKey}`;

      const gcsRes = await gcsRequest({
        method: 'GET',
        path: metaPath,
        headers: auth,
      });
      const body = await readBody(gcsRes);

      if (gcsRes.statusCode === 404) {
        res.writeHead(404);
        res.end();
        return;
      }
      if (gcsRes.statusCode < 200 || gcsRes.statusCode >= 300) {
        console.error(`[gcs-s3-proxy] HEAD ${objectKey}: GCS ${gcsRes.statusCode}`, body.slice(0, 300));
        res.writeHead(500);
        res.end();
        return;
      }

      const meta = JSON.parse(body);
      const size = parseInt(meta.size || '0', 10);
      const etag = meta.etag || meta.md5Hash || '';
      res.writeHead(200, {
        'Content-Length': String(size),
        'Content-Type': meta.contentType || 'application/octet-stream',
        ETag: `"${etag}"`,
        'Last-Modified': meta.updated || new Date().toUTCString(),
        'Accept-Ranges': 'bytes',
      });
      res.end();
      return;
    }

    // -----------------------------------------------------------------------
    // DELETE /{bucket}/{key} — delete object
    // -----------------------------------------------------------------------
    if (method === 'DELETE' && objectKey) {
      const encodedKey = encodeURIComponent(objectKey);
      const deletePath =
        `/storage/v1/b/${encodeURIComponent(gcsBucket)}/o/${encodedKey}`;

      const gcsRes = await gcsRequest({
        method: 'DELETE',
        path: deletePath,
        headers: auth,
      });
      // Drain body
      await readBody(gcsRes);

      if (gcsRes.statusCode === 404) {
        // S3 returns 204 for delete even if the key didn't exist.
        res.writeHead(204);
        res.end();
        return;
      }
      if (gcsRes.statusCode < 200 || gcsRes.statusCode >= 300) {
        res.writeHead(500);
        res.end(s3Error('InternalError', `GCS delete returned ${gcsRes.statusCode}`));
        return;
      }
      res.writeHead(204);
      res.end();
      return;
    }

    // -----------------------------------------------------------------------
    // GET /{bucket}?list-type=2 — list objects (S3 ListObjectsV2)
    // -----------------------------------------------------------------------
    if (method === 'GET' && !objectKey && urlObj.searchParams.has('list-type')) {
      const prefix = urlObj.searchParams.get('prefix') || '';
      const pageToken = urlObj.searchParams.get('continuation-token') || '';
      const maxResults = urlObj.searchParams.get('max-keys') || '1000';

      let listPath =
        `/storage/v1/b/${encodeURIComponent(gcsBucket)}/o?` +
        `maxResults=${encodeURIComponent(maxResults)}`;
      if (prefix) listPath += `&prefix=${encodeURIComponent(prefix)}`;
      if (pageToken) listPath += `&pageToken=${encodeURIComponent(pageToken)}`;

      const gcsRes = await gcsRequest({
        method: 'GET',
        path: listPath,
        headers: auth,
      });
      const body = await readBody(gcsRes);

      if (gcsRes.statusCode < 200 || gcsRes.statusCode >= 300) {
        console.error(`[gcs-s3-proxy] LIST: GCS ${gcsRes.statusCode}`, body.slice(0, 300));
        res.writeHead(500);
        res.end(s3Error('InternalError', `GCS list returned ${gcsRes.statusCode}`));
        return;
      }

      const data = JSON.parse(body);
      const items = (data.items || []).map((o) => ({
        key: o.name,
        size: parseInt(o.size || '0', 10),
        etag: o.etag || o.md5Hash || '',
        updated: o.updated,
      }));
      const nextToken = data.nextPageToken || null;
      const isTruncated = Boolean(nextToken);

      const xml = s3ListResult({
        bucket: bucketName,
        prefix,
        items,
        nextToken,
        isTruncated,
      });
      res.writeHead(200, { 'Content-Type': 'application/xml' });
      res.end(xml);
      return;
    }

    // -----------------------------------------------------------------------
    // Fallback
    // -----------------------------------------------------------------------
    res.writeHead(405);
    res.end(s3Error('MethodNotAllowed', `${method} not supported on this path`));
  } catch (err) {
    console.error('[gcs-s3-proxy] Unhandled error:', err);
    if (!res.headersSent) {
      res.writeHead(500);
      res.end(s3Error('InternalError', String(err.message || err)));
    }
  }
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------
async function main() {
  // Verify sidecar is reachable and warm the token/bucket caches before
  // accepting requests so the first upload doesn't race the token fetch.
  console.error('[gcs-s3-proxy] Connecting to Replit sidecar...');
  await getBucketId();
  await getToken();
  console.error('[gcs-s3-proxy] Sidecar ready.');

  const server = http.createServer((req, res) => {
    handleRequest(req, res).catch((err) => {
      console.error('[gcs-s3-proxy] Fatal handler error:', err);
      if (!res.headersSent) {
        res.writeHead(500);
        res.end();
      }
    });
  });

  server.listen(LISTEN_PORT, LISTEN_HOST, () => {
    console.error(`[gcs-s3-proxy] Listening on http://${LISTEN_HOST}:${LISTEN_PORT}`);
  });

  // Graceful shutdown
  process.on('SIGTERM', () => {
    console.error('[gcs-s3-proxy] SIGTERM received, shutting down.');
    server.close(() => process.exit(0));
  });
}

main().catch((err) => {
  console.error('[gcs-s3-proxy] Startup failed:', err);
  process.exit(1);
});
