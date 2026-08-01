/**
 * Minimal browser-side PNG tEXt chunk reader — web parity for desktop's
 * snapshot PNG decoding (managed_agents/agent_snapshot.rs + team_snapshot.rs).
 *
 * `.agent.png` / `.team.png` snapshots embed their JSON manifest as
 * base64 in an uncompressed tEXt chunk keyed by `buzz_agent_snapshot` /
 * `buzz_team_snapshot`. This module walks the PNG chunk stream, finds the
 * requested keyword, and returns the decoded JSON text so the existing
 * .json parsers (parseSnapshot / parseTeamSnapshot) can validate it.
 */

import { MAX_SNAPSHOT_JSON_BYTES } from "./agent-snapshot";

/** Desktop agent_snapshot.rs PNG_CHUNK_KEYWORD. */
export const AGENT_PNG_CHUNK_KEYWORD = "buzz_agent_snapshot";
/** Desktop team_snapshot.rs PNG_CHUNK_KEYWORD. */
export const TEAM_PNG_CHUNK_KEYWORD = "buzz_team_snapshot";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * Find an uncompressed tEXt chunk with `keyword` and return its raw text
 * (Latin-1). Returns undefined when no matching chunk exists; throws when
 * the bytes are not a PNG at all.
 */
export function readPngTextChunk(bytes: Uint8Array, keyword: string): string | undefined {
  if (bytes.length < PNG_SIGNATURE.length + 12) throw new Error("File is not a PNG.");
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) throw new Error("File is not a PNG.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = PNG_SIGNATURE.length;
  // Each chunk: 4-byte length, 4-byte type, data, 4-byte CRC.
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7],
    );
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.length) break; // truncated chunk
    if (type === "tEXt") {
      // tEXt payload: keyword, NUL separator, Latin-1 text.
      const nul = bytes.indexOf(0, dataStart);
      if (nul > dataStart && nul < dataEnd) {
        const k = latin1(bytes.subarray(dataStart, nul));
        if (k === keyword) return latin1(bytes.subarray(nul + 1, dataEnd));
      }
    }
    if (type === "IEND") break;
    offset = dataEnd + 4;
  }
  return undefined;
}

function latin1(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
  return out;
}

// ── Encoder ──────────────────────────────────────────────────────────────────
//
// Web counterpart of desktop's encode_snapshot_png (agent_snapshot.rs):
// the manifest JSON is base64-encoded into an uncompressed tEXt chunk. When a
// PNG avatar is available it becomes the image body (tEXt spliced in after
// IHDR); otherwise a minimal 1×1 transparent placeholder is used. Chunk CRCs
// are computed properly so strict decoders (desktop's `png` crate) accept the
// output.

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** Build a full PNG chunk (length + type + data + CRC). */
function buildChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** Build a tEXt chunk: keyword, NUL, Latin-1 text (base64 here, so ASCII). */
function buildTextChunk(keyword: string, text: string): Uint8Array {
  const data = new Uint8Array(keyword.length + 1 + text.length);
  for (let i = 0; i < keyword.length; i++) data[i] = keyword.charCodeAt(i) & 0xff;
  data[keyword.length] = 0;
  for (let i = 0; i < text.length; i++) {
    data[keyword.length + 1 + i] = text.charCodeAt(i) & 0xff;
  }
  return buildChunk("tEXt", data);
}

/**
 * Minimal 1×1 transparent RGBA PNG body (desktop's make_png_with_text
 * placeholder): IHDR + a stored-block zlib IDAT for one blank scanline.
 */
function placeholderChunks(): Uint8Array[] {
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, 1); // width
  v.setUint32(4, 1); // height
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  // zlib header, stored deflate block, 5 raw bytes (filter + RGBA), adler32.
  const idat = new Uint8Array([
    0x78, 0x01, 0x01, 0x05, 0x00, 0xfa, 0xff, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x05, 0x00, 0x01,
  ]);
  return [buildChunk("IHDR", ihdr), buildChunk("IDAT", idat)];
}

function isPng(bytes: Uint8Array): boolean {
  if (bytes.length < PNG_SIGNATURE.length + 12) return false;
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) return false;
  }
  return true;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/**
 * Encode a snapshot manifest (JSON text) into a PNG with a base64 tEXt chunk
 * under `keyword` — the inverse of `extractPngSnapshotJson`, matching
 * desktop's encode. When `basePng` is a valid PNG (e.g. the persona's avatar),
 * the chunk is spliced in right after IHDR, preserving the image; otherwise a
 * 1×1 transparent placeholder is produced.
 */
export function encodePngWithSnapshotJson(
  jsonText: string,
  keyword: string,
  basePng?: Uint8Array | null,
): Uint8Array {
  const jsonBytes = new TextEncoder().encode(jsonText);
  const textChunk = buildTextChunk(keyword, btoa(latin1(jsonBytes)));

  if (basePng && isPng(basePng)) {
    // Splice the tEXt chunk immediately after IHDR (which the signature
    // check guarantees starts at byte 8; its total size is 12 + data length).
    const view = new DataView(basePng.buffer, basePng.byteOffset, basePng.byteLength);
    const ihdrLen = view.getUint32(8);
    const ihdrEnd = 8 + 12 + ihdrLen;
    if (ihdrEnd <= basePng.length) {
      return concat([basePng.subarray(0, ihdrEnd), textChunk, basePng.subarray(ihdrEnd)]);
    }
  }
  const signature = new Uint8Array(PNG_SIGNATURE);
  const [ihdr, idat] = placeholderChunks();
  return concat([signature, ihdr, textChunk, idat, buildChunk("IEND", new Uint8Array(0))]);
}

/**
 * Extract the snapshot manifest JSON text from a `.agent.png` / `.team.png`:
 * locate the keyword's tEXt chunk, base64-decode it, and bound the decoded
 * JSON by the shared 5 MiB snapshot limit (desktop decode parity).
 */
export function extractPngSnapshotJson(bytes: Uint8Array, keyword: string): string {
  const chunkText = readPngTextChunk(bytes, keyword);
  if (chunkText === undefined) {
    throw new Error(`PNG does not contain a ${keyword} tEXt chunk.`);
  }
  let decoded: string;
  try {
    decoded = atob(chunkText.trim());
  } catch {
    throw new Error("Invalid base64 in PNG snapshot chunk.");
  }
  if (decoded.length > MAX_SNAPSHOT_JSON_BYTES) {
    throw new Error("Snapshot manifest exceeds the 5 MiB limit.");
  }
  // atob yields a binary string; re-interpret as UTF-8 JSON text.
  const raw = Uint8Array.from(decoded, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(raw);
}
