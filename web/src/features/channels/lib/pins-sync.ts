/**
 * Pure helpers for the pinned-channels sync slot (kind 30078, d-tag
 * "channel-stars", desktop contract). Plaintext JSON inside the
 * NIP-44-self-encrypted content:
 *   { "version": 1, "channels": { "<channelId>": { "starred": bool, "updatedAt": ms } } }
 * Merge is last-write-wins per channel by updatedAt (ties keep local).
 */

export interface PinEntry {
  starred: boolean;
  updatedAt: number;
}

export function parsePinsJson(plaintext: string): Record<string, PinEntry> | null {
  try {
    const parsed: unknown = JSON.parse(plaintext);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const p = parsed as Record<string, unknown>;
    if (p.version !== 1 || !p.channels || typeof p.channels !== "object" || Array.isArray(p.channels)) {
      return null;
    }
    const out: Record<string, PinEntry> = {};
    for (const [k, v] of Object.entries(p.channels as Record<string, unknown>)) {
      if (!v || typeof v !== "object") continue;
      const e = v as Record<string, unknown>;
      if (typeof e.starred === "boolean" && typeof e.updatedAt === "number" && e.updatedAt >= 0) {
        out[k] = { starred: e.starred, updatedAt: e.updatedAt };
      }
    }
    return out;
  } catch {
    return null;
  }
}

/** LWW per channel; ties keep the local entry (desktop's >= rule). */
export function mergePins(
  local: Record<string, PinEntry>,
  remote: Record<string, PinEntry>,
): Record<string, PinEntry> {
  const out = { ...local };
  for (const [k, v] of Object.entries(remote)) {
    if ((out[k]?.updatedAt ?? -1) < v.updatedAt) out[k] = v;
  }
  return out;
}
