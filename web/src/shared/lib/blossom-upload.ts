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

const KIND_BLOSSOM_AUTH = 24242;
/** Desktop uses 300s for non-video uploads. */
const AUTH_EXPIRATION_SECS = 300;

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

/**
 * Upload raw bytes to the relay's Blossom endpoint. Returns the server's
 * blob descriptor with the original `filename` re-attached (and any `thumb`
 * stripped — a snapshot has no local thumbnail sidecar; see NIP-92).
 */
export async function uploadMediaBytes(
  bytes: Uint8Array,
  filename: string,
  mimeType: string,
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

  let res = await fetch(`${baseUrl}/upload`, { method: "PUT", headers, body });
  if (res.status === 404 || res.status === 405) {
    // Legacy media-only alias for older relays.
    res = await fetch(`${baseUrl}/media/upload`, { method: "PUT", headers, body });
  }
  if (!res.ok) {
    const reason = (await res.text().catch(() => "")).slice(0, 200);
    throw new Error(`Upload failed (${res.status})${reason ? `: ${reason}` : ""}`);
  }

  const descriptor = (await res.json()) as BlobDescriptor;
  const { thumb: _thumb, ...withoutThumb } = descriptor;
  return { ...withoutThumb, filename };
}
