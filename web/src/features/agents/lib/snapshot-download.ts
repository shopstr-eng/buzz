/**
 * Small browser helpers shared by the snapshot export flows:
 * trigger a file download from bytes and decode a base64 data URL
 * (persona avatar) back to raw bytes for use as a PNG image body.
 */

/** Trigger a browser download of `bytes` as `fileName`. */
export function downloadBytes(bytes: Uint8Array, fileName: string, mime: string): void {
  const blob = new Blob([bytes.slice().buffer], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Decode a `data:<mime>;base64,<data>` URL to raw bytes (desktop's
 * decode_avatar_data_url parity). Returns null for non-data URLs or when
 * decoding fails.
 */
export function dataUrlToBytes(url: string): Uint8Array | null {
  if (!url.startsWith("data:")) return null;
  const comma = url.indexOf(",");
  if (comma < 0 || !url.slice(0, comma).includes("base64")) return null;
  try {
    const bin = atob(url.slice(comma + 1).trim());
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}
