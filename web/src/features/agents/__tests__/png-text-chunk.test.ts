/**
 * Browser-side PNG tEXt chunk reader tests — builds real minimal PNGs
 * (signature + IHDR + tEXt + IEND with valid layout) and asserts the
 * decoder mirrors desktop's decode_team_snapshot_png behavior:
 * keyword lookup, base64 decode, and error cases.
 */

import { describe, expect, it } from "vitest";
import {
  AGENT_PNG_CHUNK_KEYWORD,
  TEAM_PNG_CHUNK_KEYWORD,
  encodePngWithSnapshotJson,
  extractPngSnapshotJson,
  readPngTextChunk,
} from "../lib/png-text-chunk";

const SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  // CRC left as zeros — the reader does not verify CRCs (desktop parity:
  // the png crate validates, but a lenient reader is fine for extraction).
  return out;
}

function textChunk(keyword: string, text: string): Uint8Array {
  const data = new Uint8Array(keyword.length + 1 + text.length);
  for (let i = 0; i < keyword.length; i++) data[i] = keyword.charCodeAt(i);
  data[keyword.length] = 0;
  for (let i = 0; i < text.length; i++) data[keyword.length + 1 + i] = text.charCodeAt(i);
  return chunk("tEXt", data);
}

function buildPng(chunks: Uint8Array[]): Uint8Array {
  // Minimal IHDR for a 1×1 grayscale image (13 bytes of data).
  const ihdrData = new Uint8Array(13);
  const v = new DataView(ihdrData.buffer);
  v.setUint32(0, 1); // width
  v.setUint32(4, 1); // height
  ihdrData[8] = 8; // bit depth
  const parts = [SIGNATURE, chunk("IHDR", ihdrData), ...chunks, chunk("IEND", new Uint8Array(0))];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

describe("readPngTextChunk", () => {
  it("finds the requested keyword's text", () => {
    const png = buildPng([textChunk("other", "nope"), textChunk(TEAM_PNG_CHUNK_KEYWORD, "aGVsbG8=")]);
    expect(readPngTextChunk(png, TEAM_PNG_CHUNK_KEYWORD)).toBe("aGVsbG8=");
  });

  it("returns undefined when the keyword is absent", () => {
    const png = buildPng([textChunk("other", "nope")]);
    expect(readPngTextChunk(png, AGENT_PNG_CHUNK_KEYWORD)).toBeUndefined();
  });

  it("throws on non-PNG bytes", () => {
    const notPng = new Uint8Array(64).fill(0x41);
    expect(() => readPngTextChunk(notPng, TEAM_PNG_CHUNK_KEYWORD)).toThrow(/not a PNG/);
  });

  it("survives a truncated trailing chunk without matching garbage", () => {
    const png = buildPng([textChunk(TEAM_PNG_CHUNK_KEYWORD, "dGV4dA==")]);
    const truncated = png.subarray(0, png.length - 6);
    expect(readPngTextChunk(truncated, TEAM_PNG_CHUNK_KEYWORD)).toBe("dGV4dA==");
  });
});

describe("extractPngSnapshotJson", () => {
  it("base64-decodes the manifest JSON from the chunk", () => {
    const manifest = JSON.stringify({ format: "buzz-team-snapshot", version: 1 });
    const png = buildPng([textChunk(TEAM_PNG_CHUNK_KEYWORD, btoa(manifest))]);
    expect(extractPngSnapshotJson(png, TEAM_PNG_CHUNK_KEYWORD)).toBe(manifest);
  });

  it("decodes UTF-8 manifests (non-ASCII team names)", () => {
    const manifest = JSON.stringify({ team: { name: "Équipe démo ✨" } });
    const bytes = new TextEncoder().encode(manifest);
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    const png = buildPng([textChunk(AGENT_PNG_CHUNK_KEYWORD, btoa(bin))]);
    expect(extractPngSnapshotJson(png, AGENT_PNG_CHUNK_KEYWORD)).toBe(manifest);
  });

  it("throws a clear error when the chunk is missing", () => {
    const png = buildPng([]);
    expect(() => extractPngSnapshotJson(png, TEAM_PNG_CHUNK_KEYWORD)).toThrow(
      /does not contain a buzz_team_snapshot/,
    );
  });

  it("throws on invalid base64", () => {
    const png = buildPng([textChunk(TEAM_PNG_CHUNK_KEYWORD, "!!not base64!!")]);
    expect(() => extractPngSnapshotJson(png, TEAM_PNG_CHUNK_KEYWORD)).toThrow(/base64/);
  });
});

describe("encodePngWithSnapshotJson", () => {
  const crcTable = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes: Uint8Array): number {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  /** Walk chunks, asserting layout and every CRC (strict-decoder parity). */
  function assertValidChunks(png: Uint8Array): string[] {
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
    const types: string[] = [];
    let off = SIGNATURE.length;
    while (off + 12 <= png.length) {
      const len = view.getUint32(off);
      const type = String.fromCharCode(png[off + 4], png[off + 5], png[off + 6], png[off + 7]);
      types.push(type);
      const crc = view.getUint32(off + 8 + len);
      expect(crc).toBe(crc32(png.subarray(off + 4, off + 8 + len)));
      if (type === "IEND") break;
      off = off + 12 + len;
    }
    return types;
  }

  it("round-trips an agent manifest through the decoder (placeholder image)", () => {
    const manifest = JSON.stringify({ format: "buzz-agent-snapshot", version: 1 });
    const png = encodePngWithSnapshotJson(manifest, AGENT_PNG_CHUNK_KEYWORD);
    expect(extractPngSnapshotJson(png, AGENT_PNG_CHUNK_KEYWORD)).toBe(manifest);
    expect(assertValidChunks(png)).toEqual(["IHDR", "tEXt", "IDAT", "IEND"]);
  });

  it("round-trips UTF-8 manifests (non-ASCII names)", () => {
    const manifest = JSON.stringify({ team: { name: "Équipe démo ✨" } });
    const png = encodePngWithSnapshotJson(manifest, TEAM_PNG_CHUNK_KEYWORD);
    expect(extractPngSnapshotJson(png, TEAM_PNG_CHUNK_KEYWORD)).toBe(manifest);
  });

  it("splices the tEXt chunk into an existing PNG after IHDR", () => {
    const base = buildPng([]);
    const manifest = JSON.stringify({ format: "buzz-agent-snapshot", version: 1 });
    const png = encodePngWithSnapshotJson(manifest, AGENT_PNG_CHUNK_KEYWORD, base);
    expect(extractPngSnapshotJson(png, AGENT_PNG_CHUNK_KEYWORD)).toBe(manifest);
    // tEXt sits right after IHDR; the rest of the base PNG is preserved.
    const ihdrEnd = SIGNATURE.length + 12 + 13;
    expect(Array.from(png.subarray(0, ihdrEnd))).toEqual(Array.from(base.subarray(0, ihdrEnd)));
    expect(String.fromCharCode(png[ihdrEnd + 4], png[ihdrEnd + 5], png[ihdrEnd + 6], png[ihdrEnd + 7])).toBe("tEXt");
    expect(Array.from(png.subarray(png.length - (base.length - ihdrEnd)))).toEqual(
      Array.from(base.subarray(ihdrEnd)),
    );
  });

  it("falls back to the placeholder when base bytes are not a PNG", () => {
    const manifest = JSON.stringify({ format: "buzz-agent-snapshot", version: 1 });
    const png = encodePngWithSnapshotJson(
      manifest,
      AGENT_PNG_CHUNK_KEYWORD,
      new Uint8Array([1, 2, 3]),
    );
    expect(extractPngSnapshotJson(png, AGENT_PNG_CHUNK_KEYWORD)).toBe(manifest);
    expect(assertValidChunks(png)).toEqual(["IHDR", "tEXt", "IDAT", "IEND"]);
  });
});
