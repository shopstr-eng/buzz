// @vitest-environment node
/**
 * Live end-to-end check for VIDEO uploads through the Blossom client against
 * a running relay.
 *
 * Mirrors blossom-upload.e2e.test.ts (photos), but exercises the relay's
 * separate streaming video pipeline (crates/buzz-media/src/upload.rs
 * process_video_upload): temp-file spooling, ISO-BMFF structural check, the
 * video-specific 1-hour auth window, full MP4 validation (single avc1 track,
 * metadata-free), and the streamed put to storage.
 *
 * Skipped unless E2E_RELAY_URL is set. Run against the local dev relay with:
 *
 *   E2E_RELAY_URL="https://$REPLIT_DEV_DOMAIN" \
 *   E2E_UPLOAD_SECKEY="$BUZZ_RELAY_PRIVATE_KEY" \
 *   npx vitest run src/shared/lib/__tests__/blossom-video-upload.e2e.test.ts
 *
 * The signer key must belong to a relay member of the community bound to the
 * E2E_RELAY_URL host (the relay owner key always qualifies on the dev relay).
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

/**
 * A minimal valid MP4 the relay's strict video validator accepts:
 * 64x64, 1s, H.264 baseline (single avc1 track), no audio, faststart
 * (moov before mdat), and metadata-free apart from ffmpeg's whitelisted
 * empty udta/meta stub. Produced with:
 *
 *   ffmpeg -f lavfi -i color=red:s=64x64:d=1:r=10 -c:v libx264 \
 *     -pix_fmt yuv420p -profile:v baseline -movflags +faststart \
 *     -map_metadata -1 -fflags +bitexact -flags:v +bitexact -an e2e.mp4
 */
const MP4_BASE64 =
  "AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAMnbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAA+gAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAnZ0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAA+gAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAEAAAABAAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAPoAAAAAAABAAAAAAHubWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAAAoAAAAKABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABmW1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAVlzdGJsAAAAuXN0c2QAAAAAAAAAAQAAAKlhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAEAAQABIAAAASAAAAAAAAAABDExhdmMgbGlieDI2NAAAAAAAAAAAAAAAAAAAAAAAAAAAGP//AAAAL2F2Y0MBQsAK/+EAF2dCwArZBCbARAAAAwAEAAADAFA8SJkgAQAFaMuDyyAAAAAQcGFzcAAAAAEAAAABAAAAFGJ0cnQAAAAAAAAXIAAAFyAAAAAYc3R0cwAAAAAAAAABAAAACgAABAAAAAAUc3RzcwAAAAAAAAABAAAAAQAAABxzdHNjAAAAAAAAAAEAAAABAAAACgAAAAEAAAA8c3RzegAAAAAAAAAAAAAACgAAAooAAAAKAAAACgAAAAoAAAAKAAAACgAAAAoAAAAKAAAACgAAAAoAAAAUc3RjbwAAAAAAAAABAAADVwAAAD11ZHRhAAAANW1ldGEAAAAAAAAAIWhkbHIAAAAAAAAAAG1kaXJhcHBsAAAAAAAAAAAAAAAACGlsc3QAAAAIZnJlZQAAAuxtZGF0AAACYwYF//9f3EXpvebZSLeWLNgg2SPu73gyNjQgLSBjb3JlIDE2NCAtIEguMjY0L01QRUctNCBBVkMgY29kZWMgLSBDb3B5bGVmdCAyMDAzLTIwMjUgLSBodHRwOi8vd3d3LnZpZGVvbGFuLm9yZy94MjY0Lmh0bWwgLSBvcHRpb25zOiBjYWJhYz0wIHJlZj0zIGRlYmxvY2s9MTowOjAgYW5hbHlzZT0weDE6MHgxMTEgbWU9aGV4IHN1Ym1lPTcgcHN5PTEgcHN5X3JkPTEuMDA6MC4wMCBtaXhlZF9yZWY9MSBtZV9yYW5nZT0xNiBjaHJvbWFfbWU9MSB0cmVsbGlzPTEgOHg4ZGN0PTAgY3FtPTAgZGVhZHpvbmU9MjEsMTEgZmFzdF9wc2tpcD0xIGNocm9tYV9xcF9vZmZzZXQ9LTIgdGhyZWFkcz0yIGxvb2thaGVhZF90aHJlYWRzPTEgc2xpY2VkX3RocmVhZHM9MCBucj0wIGRlY2ltYXRlPTEgaW50ZXJsYWNlZD0wIGJsdXJheV9jb21wYXQ9MCBjb25zdHJhaW5lZF9pbnRyYT0wIGJmcmFtZXM9MCB3ZWlnaHRwPTAga2V5aW50PTI1MCBrZXlpbnRfbWluPTEwIHNjZW5lY3V0PTQwIGludHJhX3JlZnJlc2g9MCByY19sb29rYWhlYWQ9NDAgcmM9Y3JmIG1idHJlZT0xIGNyZj0yMy4wIHFjb21wPTAuNjAgcXBtaW49MCBxcG1heD02OSBxcHN0ZXA9NCBpcF9yYXRpbz0xLjQwIGFxPTE6MS4wMACAAAAAH2WIhA/xGKAAJvscAARwY4AAq5ScnJ1111111111114AAAAGQZo4H+EYAAAABkGaVAf4RgAAAAZBmmA/wjAAAAAGQZqAP8IwAAAABkGaoD/CMAAAAAZBmsA/wjAAAAAGQZrgP8IwAAAABkGbADvCMAAAAAZBmyA3wjA=";

describe.skipIf(!RELAY_URL || !SECKEY_HEX)(
  "blossom video upload end-to-end (live relay)",
  () => {
    it("streams an MP4 through the video pipeline, gets a descriptor, and fetches the bytes back", async () => {
      const { uploadMediaBytes } = await import("../blossom-upload");

      const bytes = Uint8Array.from(atob(MP4_BASE64), (c) => c.charCodeAt(0));
      const expectedSha = await sha256Hex(bytes);

      const descriptor = await uploadMediaBytes(
        bytes,
        "e2e-clip.mp4",
        "video/mp4",
      );

      // Valid BUD-02 blob descriptor from the streaming video pipeline
      expect(descriptor.sha256).toBe(expectedSha);
      expect(descriptor.size).toBe(bytes.length);
      expect(descriptor.type).toBe("video/mp4");
      expect(descriptor.url).toMatch(/^https?:\/\//);
      expect(descriptor.url).toContain(expectedSha);
      expect(descriptor.filename).toBe("e2e-clip.mp4");

      // Video-specific metadata extracted by validate_video_file
      expect(descriptor.dim).toBe("64x64");
      expect(descriptor.duration).toBeGreaterThan(0);
      // No blurhash/thumb for video (server leaves them empty; client strips thumb)
      expect(descriptor.blurhash).toBeUndefined();
      expect(descriptor.thumb).toBeUndefined();

      // Blob is retrievable at the returned URL with identical bytes
      const res = await fetch(descriptor.url);
      expect(res.status).toBe(200);
      expect(res.headers.get("accept-ranges")).toBe("bytes");
      const fetched = new Uint8Array(await res.arrayBuffer());
      expect(fetched.length).toBe(bytes.length);
      expect(await sha256Hex(fetched)).toBe(expectedSha);
    }, 60_000);
  },
);
