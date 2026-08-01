// @vitest-environment node
/**
 * Live end-to-end checks that the relay REJECTS oversized or unsupported
 * video uploads with a clear, actionable HTTP error (not a 500 or a hang).
 *
 * Companion to blossom-video-upload.e2e.test.ts (the happy path). Each case
 * starts from the same known-valid MP4 and byte-patches exactly one thing so
 * a single relay-side validation rule fires:
 *
 *   - Content-Length over max_video_bytes  -> 413 "file too large"
 *   - stsd sample entry avc1 -> hvc1       -> 415 WrongCodec
 *   - udta atom renamed to uuid            -> 422 MetadataForbidden
 *   - ftyp major brand isom -> "qt  "      -> 415 UnsupportedContainer
 *   - mvhd/tkhd/mdhd durations -> 601s     -> 422 DurationTooLong
 *   - stsd avc1 width/height -> 7680x4320  -> 422 ResolutionTooHigh
 *
 * Also asserts the web client surfaces the server's reason text: the error
 * thrown by uploadMediaBytes must include the response body.
 *
 * Skipped unless E2E_RELAY_URL is set. Run against the local dev relay with:
 *
 *   E2E_RELAY_URL="https://$REPLIT_DEV_DOMAIN" \
 *   E2E_RELAY_DIRECT_URL="http://127.0.0.1:5000" \
 *   E2E_UPLOAD_SECKEY="$BUZZ_RELAY_PRIVATE_KEY" \
 *   npx vitest run src/shared/lib/__tests__/blossom-video-rejects.e2e.test.ts
 *
 * E2E_RELAY_DIRECT_URL (optional) points at the relay without the dev-domain
 * reverse proxy; the oversized-upload test needs the relay's early 413, which
 * a buffering proxy would hold back while waiting for the full declared body.
 *
 * The signer key must belong to a relay member of the community bound to the
 * E2E_RELAY_URL host (the relay owner key always qualifies on the dev relay).
 */
import { describe, expect, it, vi } from "vitest";
import { finalizeEvent } from "nostr-tools/pure";

const env: Record<string, string | undefined> =
  (globalThis as { process?: { env: Record<string, string | undefined> } })
    .process?.env ?? {};
const RELAY_URL = env.E2E_RELAY_URL ?? "";
const SECKEY_HEX = env.E2E_UPLOAD_SECKEY ?? "";
/**
 * Optional direct (unproxied) address of the same relay, e.g.
 * "http://127.0.0.1:5000" on the dev box. The oversized-Content-Length test
 * needs the relay's EARLY 413 response, which a buffering reverse proxy (like
 * the Replit dev-domain proxy) swallows while it waits for the declared body.
 * The Host header is still set to the E2E_RELAY_URL host, so tenant binding
 * and the Blossom `server` tag are unaffected.
 */
const DIRECT_URL = env.E2E_RELAY_DIRECT_URL ?? RELAY_URL;

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

/** Same known-valid MP4 as blossom-video-upload.e2e.test.ts (64x64 H.264). */
const MP4_BASE64 =
  "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";

function baseMp4(): Uint8Array {
  return Uint8Array.from(atob(MP4_BASE64), (c) => c.charCodeAt(0));
}

/** Index of the first occurrence of an ASCII pattern at/after `from`. */
function indexOfAscii(bytes: Uint8Array, pattern: string, from = 0): number {
  const pat = Array.from(pattern, (c) => c.charCodeAt(0));
  outer: for (let i = from; i <= bytes.length - pat.length; i++) {
    for (let j = 0; j < pat.length; j++) {
      if (bytes[i + j] !== pat[j]) continue outer;
    }
    return i;
  }
  return -1;
}

function patchAscii(bytes: Uint8Array, at: number, replacement: string): void {
  for (let j = 0; j < replacement.length; j++) {
    bytes[at + j] = replacement.charCodeAt(j);
  }
}

function readU32(bytes: Uint8Array, at: number): number {
  return (
    ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0
  );
}

function writeU32(bytes: Uint8Array, at: number, value: number): void {
  bytes[at] = (value >>> 24) & 0xff;
  bytes[at + 1] = (value >>> 16) & 0xff;
  bytes[at + 2] = (value >>> 8) & 0xff;
  bytes[at + 3] = value & 0xff;
}

function writeU16(bytes: Uint8Array, at: number, value: number): void {
  bytes[at] = (value >>> 8) & 0xff;
  bytes[at + 1] = value & 0xff;
}

async function uploadExpectingRejection(
  bytes: Uint8Array,
  filename: string,
): Promise<Error> {
  const { uploadMediaBytes } = await import("../blossom-upload");
  try {
    await uploadMediaBytes(bytes, filename, "video/mp4");
  } catch (e) {
    return e as Error;
  }
  throw new Error(`relay accepted ${filename} but should have rejected it`);
}

describe.skipIf(!RELAY_URL || !SECKEY_HEX)(
  "blossom video upload rejections (live relay)",
  () => {
    it("rejects a Content-Length over max_video_bytes with 413 before streaming", async () => {
      // fetch() derives Content-Length from the body, so use a raw node
      // https request to declare an absurd length (10 GiB — over any sane
      // max_video_bytes) while sending only a tiny valid-MP4-prefix body.
      // The relay must fast-fail on the header with 413, not hang waiting
      // for 10 GiB.
      // The web build's tsc pass compiles this file without node types, so
      // keep the node:http(s) module untyped.
      const { request } = (await import(
        DIRECT_URL.startsWith("https") ? "node:https" : "node:http"
      )) as {
        request: (
          options: Record<string, unknown>,
          cb: (res: {
            statusCode?: number;
            on: (ev: string, fn: (arg?: unknown) => void) => void;
          }) => void,
        ) => {
          on: (ev: string, fn: (err: Error) => void) => void;
          write: (chunk: Uint8Array) => void;
          flushHeaders: () => void;
        };
      };
      // The relay sniffs the first 4 KiB of the body (to pick the video
      // pipeline from real bytes) BEFORE the Content-Length fast-fail runs,
      // so the body we actually send must cover the sniff window. Pad the
      // valid MP4 prefix with zeros past 4 KiB; we still never send more
      // than ~8 KiB of the declared 10 GiB.
      const mp4 = baseMp4();
      const bytes = new Uint8Array(8192);
      bytes.set(mp4);
      const hash = await sha256Hex(bytes);
      const now = Math.floor(Date.now() / 1000);
      const key = hexToBytes(SECKEY_HEX.trim());
      const authEvent = finalizeEvent(
        {
          kind: 24242,
          created_at: now,
          tags: [
            ["t", "upload"],
            ["x", hash],
            ["expiration", String(now + 300)],
            ["server", new URL(RELAY_URL).host],
          ],
          content: "Upload oversized.mp4",
        },
        key,
      );

      const url = new URL(`${DIRECT_URL.replace(/\/$/, "")}/upload`);
      const TEN_GIB = 10 * 1024 * 1024 * 1024;
      const { status, body } = await new Promise<{
        status: number;
        body: string;
      }>((resolve, reject) => {
        const req = request(
          {
            method: "PUT",
            hostname: url.hostname,
            port: url.port || undefined,
            path: url.pathname,
            headers: {
              // Tenant binding is by Host header — always the proxied relay
              // host, even when connecting via a direct loopback address.
              Host: new URL(RELAY_URL).host,
              Authorization: `Nostr ${btoa(JSON.stringify(authEvent))}`,
              "Content-Type": "video/mp4",
              "X-SHA-256": hash,
              "Content-Length": String(TEN_GIB),
            },
          },
          (res) => {
            let text = "";
            res.on("data", (c) => {
              text += new TextDecoder().decode(c as Uint8Array);
            });
            res.on("end", () =>
              resolve({ status: res.statusCode ?? 0, body: text }),
            );
            res.on("error", (e) => reject(e));
          },
        );
        // The server responds (and resets) before the body completes — an
        // ECONNRESET/EPIPE after we already have the response is expected,
        // so only reject if no response arrived yet.
        let responded = false;
        req.on("response", () => {
          responded = true;
        });
        req.on("error", (e: Error) => {
          if (!responded) reject(e);
        });
        // Write only the padded sniff-window bytes; never send 10 GiB.
        req.write(bytes);
        req.flushHeaders();
      });

      expect(status).toBe(413);
      // The relay's own fast-fail says "file too large: N bytes (max M)";
      // axum's transport-level body cap says "length limit exceeded". Both
      // are clear 413 size rejections — accept either wording.
      expect(body.toLowerCase()).toMatch(
        /file too large|length limit|body limit/,
      );
    }, 60_000);

    it("rejects a non-H.264 codec (avc1 patched to hvc1) with a clear codec error", async () => {
      const bytes = baseMp4();
      // Patch only the stsd sample-entry fourcc, not the ftyp compatible
      // brand "avc1" earlier in the file.
      const stsd = indexOfAscii(bytes, "stsd");
      expect(stsd).toBeGreaterThan(0);
      const avc1 = indexOfAscii(bytes, "avc1", stsd);
      expect(avc1).toBeGreaterThan(stsd);
      patchAscii(bytes, avc1, "hvc1");

      const err = await uploadExpectingRejection(bytes, "hevc.mp4");
      // WrongCodec -> 415 with the H.264/AAC guidance. A parser that chokes
      // on the unknown sample entry instead yields 422 "invalid video data";
      // either way it must be a clear 4xx, never a 500 or a hang.
      expect(err.message).toMatch(/Upload failed \(4(15|22)\)/);
      expect(err.message.toLowerCase()).toMatch(
        /unsupported media codec|invalid video data/,
      );
    }, 60_000);

    it("rejects embedded metadata (udta renamed to forbidden uuid box) with 422", async () => {
      const bytes = baseMp4();
      const udta = indexOfAscii(bytes, "udta");
      expect(udta).toBeGreaterThan(0);
      patchAscii(bytes, udta, "uuid");

      const err = await uploadExpectingRejection(bytes, "metadata.mp4");
      expect(err.message).toContain("Upload failed (422)");
      expect(err.message.toLowerCase()).toContain("metadata");
    }, 60_000);

    it("rejects a video longer than 600 seconds with 422 'video too long'", async () => {
      const bytes = baseMp4();
      // Patch every duration field to 601 seconds so the file is internally
      // consistent. All boxes here are version 0:
      //   mvhd: fourcc + ver/flags(4) + creation(4) + modification(4)
      //         + timescale(4) @+16 + duration(4) @+20
      //   tkhd: fourcc + ver/flags(4) + creation(4) + modification(4)
      //         + track_id(4) + reserved(4) + duration(4) @+24 (movie timescale)
      //   mdhd: same layout as mvhd — timescale @+16, duration @+20.
      // The relay's duration check reads mdhd (track timescale), but patching
      // mvhd/tkhd too keeps the container coherent.
      const SECONDS = 601;
      const mvhd = indexOfAscii(bytes, "mvhd");
      expect(mvhd).toBeGreaterThan(0);
      const movieTimescale = readU32(bytes, mvhd + 16);
      expect(movieTimescale).toBeGreaterThan(0);
      writeU32(bytes, mvhd + 20, movieTimescale * SECONDS);

      const tkhd = indexOfAscii(bytes, "tkhd");
      expect(tkhd).toBeGreaterThan(0);
      writeU32(bytes, tkhd + 24, movieTimescale * SECONDS);

      const mdhd = indexOfAscii(bytes, "mdhd");
      expect(mdhd).toBeGreaterThan(0);
      const trackTimescale = readU32(bytes, mdhd + 16);
      expect(trackTimescale).toBeGreaterThan(0);
      writeU32(bytes, mdhd + 20, trackTimescale * SECONDS);

      const err = await uploadExpectingRejection(bytes, "too-long.mp4");
      expect(err.message).toContain("Upload failed (422)");
      expect(err.message.toLowerCase()).toContain("video too long");
    }, 60_000);

    it("rejects a resolution over 3840x2160 with 422 'resolution too high'", async () => {
      const bytes = baseMp4();
      // The relay reads resolution from the stsd avc1 sample entry (falling
      // back to tkhd only when absent). avc1 layout after the fourcc:
      // reserved(6) + data_ref_index(2) + pre_defined(2) + reserved(2)
      // + pre_defined(12) + width(2) @+28 + height(2) @+30.
      const stsd = indexOfAscii(bytes, "stsd");
      expect(stsd).toBeGreaterThan(0);
      const avc1 = indexOfAscii(bytes, "avc1", stsd);
      expect(avc1).toBeGreaterThan(stsd);
      writeU16(bytes, avc1 + 28, 7680);
      writeU16(bytes, avc1 + 30, 4320);

      // Keep tkhd's fixed-point 16.16 width/height consistent: fourcc
      // + ver/flags(4) + creation(4) + modification(4) + track_id(4)
      // + reserved(4) + duration(4) + reserved(8) + layer(2) + alt_group(2)
      // + volume(2) + reserved(2) + matrix(36) => width @+80, height @+84
      // (offsets from the start of the "tkhd" fourcc itself).
      const tkhd = indexOfAscii(bytes, "tkhd");
      expect(tkhd).toBeGreaterThan(0);
      writeU32(bytes, tkhd + 80, 7680 << 16);
      writeU32(bytes, tkhd + 84, 4320 << 16);

      const err = await uploadExpectingRejection(bytes, "8k.mp4");
      expect(err.message).toContain("Upload failed (422)");
      expect(err.message.toLowerCase()).toContain("resolution too high");
    }, 60_000);

    it("rejects a QuickTime container (ftyp major brand qt) with 415", async () => {
      const bytes = baseMp4();
      // ftyp box: size(4) + "ftyp"(4) + major brand(4). The compatible-brand
      // list still contains isom/avc1, so the upload passes the structural
      // ISO-BMFF sniff and reaches the full validator's container check.
      expect(indexOfAscii(bytes, "ftyp")).toBe(4);
      patchAscii(bytes, 8, "qt  ");

      const err = await uploadExpectingRejection(bytes, "quicktime.mp4");
      expect(err.message).toContain("Upload failed (415)");
      expect(err.message.toLowerCase()).toContain(
        "unsupported container: only mp4 is accepted",
      );
    }, 60_000);
  },
);
