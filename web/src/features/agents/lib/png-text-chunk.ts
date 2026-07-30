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
