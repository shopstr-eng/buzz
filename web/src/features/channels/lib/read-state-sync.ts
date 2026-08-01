/**
 * Pure helpers for the NIP-RS read-state slot format (kind 30078, desktop
 * contract). Plaintext JSON inside the NIP-44-self-encrypted content:
 *   { "v": 1, "client_id": "<uuid>", "contexts": { "<ctx>": <unix secs> } }
 * Context keys: "msg:<eventId>" and "thread:<eventId>" (desktop's granular
 * markers) and bare channel ids (channel-level markers). Merge is max per
 * key across all slots — monotonic, so pruning never propagates deletion.
 */

export interface ReadStateSlot {
  v: number;
  client_id: string;
  contexts: Record<string, number>;
}

/** Desktop's plaintext budget; slots split beyond it (web stays single-slot). */
export const READ_STATE_BUDGET_BYTES = 32_768;

export function parseSlotJson(plaintext: string): ReadStateSlot | null {
  try {
    const parsed: unknown = JSON.parse(plaintext);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const p = parsed as Record<string, unknown>;
    if (p.v !== 1 || typeof p.client_id !== "string") return null;
    if (!p.contexts || typeof p.contexts !== "object" || Array.isArray(p.contexts)) return null;
    const contexts: Record<string, number> = {};
    for (const [k, v] of Object.entries(p.contexts as Record<string, unknown>)) {
      // ov_* override counters legitimately carry 0 (e.g. ov_c in a live
      // group); group-level validation happens later in splitContexts.
      const min = k.startsWith("ov_") ? 0 : 1;
      if (typeof v === "number" && Number.isFinite(v) && v >= min) contexts[k] = v;
    }
    return { v: 1, client_id: p.client_id, contexts };
  } catch {
    return null;
  }
}

/** Max-per-key merge (monotonic — the NIP-RS frontier rule). */
export function mergeContexts(
  a: Record<string, number>,
  b: Record<string, number>,
): Record<string, number> {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) {
    if ((out[k] ?? 0) < v) out[k] = v;
  }
  return out;
}

/** Channel-level markers = bare keys (desktop's msg:/thread: excluded). */
export function channelMarkers(contexts: Record<string, number>): Array<[string, number]> {
  return Object.entries(contexts).filter(
    ([k]) => !k.startsWith("msg:") && !k.startsWith("thread:") && !k.startsWith("ov_"),
  );
}

export interface BuiltSlot {
  json: string;
  /** false when the slot exceeds the budget even after all frontier eviction. */
  fits: boolean;
}

/**
 * Serialize a slot from RAW frontier entries plus canonical ov_* override
 * wire entries (see unread-override.ts). Frontier keys are escaped on encode
 * (esc: prefix for raw ids starting with ov_/esc: — NIP-RS Reserved
 * Namespace). When over budget, evict OLDEST bare-channel markers first, then
 * oldest msg:/thread: markers. ov_* entries are durable and NEVER evicted;
 * if they alone exceed the budget, `fits` is false and the caller MUST NOT
 * publish (NIP-RS terminal behaviour at the ceiling — visible failure, never
 * silent degradation). Frontier eviction is safe: merge is monotonic, so a
 * pruned key re-merges from the originating client's slot.
 */
export function buildSlot(
  clientId: string,
  frontier: Record<string, number>,
  overrideEntries: Record<string, number> = {},
  budget = READ_STATE_BUDGET_BYTES,
): BuiltSlot {
  const escaped: Record<string, number> = {};
  for (const [k, v] of Object.entries(frontier)) {
    escaped[k.startsWith("ov_") || k.startsWith("esc:") ? `esc:${k}` : k] = v;
  }
  const encode = (ctx: Record<string, number>) =>
    JSON.stringify({ v: 1, client_id: clientId, contexts: { ...ctx, ...overrideEntries } });
  let json = encode(escaped);
  if (json.length <= budget) return { json, fits: true };
  const bare = channelMarkers(escaped).sort((x, y) => x[1] - y[1]);
  const granular = Object.entries(escaped)
    .filter(([k]) => k.startsWith("msg:") || k.startsWith("thread:"))
    .sort((x, y) => x[1] - y[1]);
  const working = { ...escaped };
  for (const [key] of [...bare, ...granular]) {
    delete working[key];
    json = encode(working);
    if (json.length <= budget) return { json, fits: true };
  }
  return { json, fits: false };
}

/** Legacy frontier-only serializer (kept for the no-override publish path). */
export function buildSlotPlaintext(
  clientId: string,
  contexts: Record<string, number>,
  budget = READ_STATE_BUDGET_BYTES,
): string {
  return buildSlot(clientId, contexts, {}, budget).json;
}
