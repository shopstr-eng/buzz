// @vitest-environment node
/**
 * Live end-to-end check for the Blossom upload client against a running relay.
 *
 * Skipped unless E2E_RELAY_URL is set (so the normal unit-test run stays
 * hermetic). Run it against the local dev relay with:
 *
 *   E2E_RELAY_URL="https://$REPLIT_DEV_DOMAIN" \
 *   E2E_UPLOAD_SECKEY="$BUZZ_RELAY_PRIVATE_KEY" \
 *   npx vitest run src/shared/lib/__tests__/blossom-upload.e2e.test.ts
 *
 * The signer key must belong to a relay member of the community bound to the
 * E2E_RELAY_URL host (the relay owner key always qualifies on the dev relay).
 *
 * This exercises the REAL uploadMediaBytes code path — kind:24242 auth event
 * tags (t/x/expiration/server), Authorization/X-SHA-256 headers, PUT /upload —
 * only the browser-session dependencies (relay URL discovery and the signing
 * key store) are substituted.
 */
import { describe, expect, it, vi } from "vitest";
import { finalizeEvent } from "nostr-tools/pure";

// The web build's tsc pass compiles this file without node types, so read
// process.env through globalThis instead of the node `process` global.
const env: Record<string, string | undefined> =
  (globalThis as { process?: { env: Record<string, string | undefined> } })
    .process?.env ?? {};
const RELAY_URL = env.E2E_RELAY_URL ?? "";
const SECKEY_HEX = env.E2E_UPLOAD_SECKEY ?? "";

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice().buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

vi.mock("../relay-url", () => ({
  relayHttpBaseUrl: () => RELAY_URL.replace(/\/$/, ""),
}));

vi.mock("../identity", () => ({
  getSignFn: () => {
    const key = hexToBytes(SECKEY_HEX.trim());
    return async (template: {
      kind: number;
      created_at: number;
      tags: string[][];
      content: string;
    }) => finalizeEvent(template, key);
  },
}));

describe.skipIf(!RELAY_URL || !SECKEY_HEX)(
  "blossom upload end-to-end (live relay)",
  () => {
    it("uploads bytes, gets a valid blob descriptor, and can fetch the blob back", async () => {
      const { uploadMediaBytes } = await import("../blossom-upload");

      // The relay fully decodes uploads, so the payload must be a real image.
      // A valid 1x1 red PNG (re-uploads dedupe to the same blob, which still
      // exercises the full auth + descriptor + retrieval path).
      const bytes = Uint8Array.from(
        atob(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==",
        ),
        (c) => c.charCodeAt(0),
      );

      const expectedSha = await sha256Hex(bytes);

      const descriptor = await uploadMediaBytes(
        bytes,
        "e2e-snapshot.png",
        "image/png",
      );

      // Valid BUD-02 blob descriptor
      expect(descriptor.sha256).toBe(expectedSha);
      expect(descriptor.size).toBe(bytes.length);
      expect(descriptor.url).toMatch(/^https?:\/\//);
      expect(descriptor.url).toContain(expectedSha);
      expect(descriptor.filename).toBe("e2e-snapshot.png");
      // Client contract: thumb is stripped for snapshot uploads
      expect(descriptor.thumb).toBeUndefined();

      // Blob is retrievable at the returned URL with identical bytes
      const res = await fetch(descriptor.url);
      expect(res.status).toBe(200);
      const fetched = new Uint8Array(await res.arrayBuffer());
      expect(fetched.length).toBe(bytes.length);
      expect(await sha256Hex(fetched)).toBe(expectedSha);
    }, 30_000);
  },
);
