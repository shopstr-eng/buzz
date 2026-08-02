/**
 * Blossom media upload client (BUD-02) for the relay's buzz-media server.
 *
 * Auth is a signed kind:24242 Nostr event (BUD-11), base64-encoded in an
 * `Authorization: Nostr …` header, with tags:
 *   t=upload, x=<sha256 of body>, expiration=<future unix ts>,
 *   server=<host authority> (scopes the token to this relay).
 *
 * Mirrors desktop's upload path (desktop/src-tauri/src/commands/media.rs):
 * PUT /upload first, retrying the legacy PUT /media/upload on 404/405.
 *
 * Uses XMLHttpRequest instead of fetch so upload progress events are
 * observable: the UI can show percent complete, and a stalled upload (no
 * bytes moving for STALL_TIMEOUT_MS) aborts with a clear error instead of
 * hanging behind a worst-case overall timeout.
 */

import { relayHttpBaseUrl } from "./relay-url";
import { getSignFn } from "./identity";

/** Blossom BUD-02 blob descriptor returned by the media server. */
export interface BlobDescriptor {
  url: string;
  sha256: string;
  size: number;
  type: string;
  uploaded?: number;
  dim?: string;
  blurhash?: string;
  thumb?: string;
  duration?: number;
  image?: string;
  /** Client-side only: original filename, preserved for imeta tags. */
  filename?: string;
}

/** Upload progress callback: bytes sent so far and the total payload size. */
export type UploadProgressFn = (sentBytes: number, totalBytes: number) => void;

const KIND_BLOSSOM_AUTH = 24242;
/** Desktop uses 300s for non-video uploads. */
const AUTH_EXPIRATION_SECS = 300;

/**
 * Abort when no upload progress is observed for this long. Replaces the old
 * coarse size-scaled overall timeout: as long as bytes keep moving the
 * upload may take as long as it needs, but a genuine stall (dead link,
 * buffering dev-domain reverse proxy swallowing the relay's early 413)
 * fails fast with a clear error.
 */
export const STALL_TIMEOUT_MS = 60_000;

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice().buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Normalized `host` or `host:port` authority for the `server` tag. */
function serverAuthority(baseUrl: string): string {
  return new URL(baseUrl).host;
}

interface XhrResponse {
  status: number;
  body: string;
}

/** Minimum overall timeout for the no-progress fetch fallback. */
const MIN_FALLBACK_TIMEOUT_MS = 120_000;
/** Assumed worst-case sustained upload throughput for the fallback timeout. */
const MIN_THROUGHPUT_BYTES_PER_SEC = 32 * 1024; // 32 KiB/s
/** Hard cap for the fallback timeout: matches the 1-hour video use case. */
const MAX_FALLBACK_TIMEOUT_MS = 60 * 60 * 1000;

/** Size-scaled overall timeout for the fetch fallback (no progress events). */
function fetchFallbackTimeoutMs(sizeBytes: number): number {
  const scaled = Math.ceil((sizeBytes / MIN_THROUGHPUT_BYTES_PER_SEC) * 1000);
  return Math.min(MAX_FALLBACK_TIMEOUT_MS, Math.max(MIN_FALLBACK_TIMEOUT_MS, scaled));
}

/**
 * Fallback for environments without XMLHttpRequest (node e2e tests): plain
 * fetch with an overall stall-cap timeout. No progress events are available.
 */
async function putWithFetch(
  url: string,
  body: ArrayBuffer,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<XhrResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "PUT",
      headers,
      body,
      signal: controller.signal,
    });
    return { status: res.status, body: await res.text().catch(() => "") };
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error(
        `Upload timed out after ${Math.round(timeoutMs / 1000)}s. ` +
          "Check your connection and try again.",
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * PUT the body via XMLHttpRequest, reporting upload progress and aborting
 * when no progress (upload or response) is observed for `stallTimeoutMs`.
 */
function putWithProgress(
  url: string,
  body: ArrayBuffer,
  headers: Record<string, string>,
  onProgress: UploadProgressFn | undefined,
  stallTimeoutMs: number,
): Promise<XhrResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let stallTimer: ReturnType<typeof setTimeout> | undefined;
    let stalled = false;

    const clearStall = () => {
      if (stallTimer !== undefined) clearTimeout(stallTimer);
      stallTimer = undefined;
    };
    const armStall = () => {
      clearStall();
      stallTimer = setTimeout(() => {
        stalled = true;
        xhr.abort();
      }, stallTimeoutMs);
    };

    xhr.open("PUT", url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);

    xhr.upload.onprogress = (ev) => {
      armStall();
      if (onProgress && ev.lengthComputable) onProgress(ev.loaded, ev.total);
    };
    // Response bytes arriving also count as progress (upload finished,
    // server still processing/replying).
    xhr.onprogress = () => armStall();

    xhr.onload = () => {
      clearStall();
      resolve({ status: xhr.status, body: xhr.responseText });
    };
    xhr.onerror = () => {
      clearStall();
      reject(new Error("Upload failed: network error."));
    };
    xhr.onabort = () => {
      clearStall();
      reject(
        stalled
          ? new Error(
              `Upload stalled — no progress for ${Math.round(stallTimeoutMs / 1000)}s. ` +
                "Check your connection and try again.",
            )
          : new Error("Upload aborted."),
      );
    };

    armStall();
    xhr.send(body);
  });
}

/**
 * Upload raw bytes to the relay's Blossom endpoint. Returns the server's
 * blob descriptor with the original `filename` re-attached (and any `thumb`
 * stripped — a snapshot has no local thumbnail sidecar; see NIP-92).
 *
 * `options.onProgress` receives (sentBytes, totalBytes) as the upload
 * advances, enabling percent-complete UI for large payloads.
 */
export async function uploadMediaBytes(
  bytes: Uint8Array,
  filename: string,
  mimeType: string,
  options?: { onProgress?: UploadProgressFn },
): Promise<BlobDescriptor> {
  const signFn = getSignFn();
  if (!signFn) {
    throw new Error("No signing key available. Please log in again.");
  }

  const baseUrl = relayHttpBaseUrl();
  const hash = await sha256Hex(bytes);
  const now = Math.floor(Date.now() / 1000);

  const authEvent = await signFn({
    kind: KIND_BLOSSOM_AUTH,
    created_at: now,
    tags: [
      ["t", "upload"],
      ["x", hash],
      ["expiration", String(now + AUTH_EXPIRATION_SECS)],
      ["server", serverAuthority(baseUrl)],
    ],
    content: `Upload ${filename}`,
  });

  const headers = {
    Authorization: `Nostr ${btoa(JSON.stringify(authEvent))}`,
    "Content-Type": mimeType,
    "X-SHA-256": hash,
  };
  const body = bytes.slice().buffer;
  const onProgress = options?.onProgress;

  const put =
    typeof XMLHttpRequest === "undefined"
      ? (url: string) => putWithFetch(url, body, headers, fetchFallbackTimeoutMs(bytes.length))
      : (url: string) => putWithProgress(url, body, headers, onProgress, STALL_TIMEOUT_MS);

  let res = await put(`${baseUrl}/upload`);
  if (res.status === 404 || res.status === 405) {
    // Legacy media-only alias for older relays.
    res = await put(`${baseUrl}/media/upload`);
  }
  if (res.status < 200 || res.status >= 300) {
    const reason = res.body.slice(0, 200);
    throw new Error(`Upload failed (${res.status})${reason ? `: ${reason}` : ""}`);
  }

  const descriptor = JSON.parse(res.body) as BlobDescriptor;
  const { thumb: _thumb, ...withoutThumb } = descriptor;
  return { ...withoutThumb, filename };
}
