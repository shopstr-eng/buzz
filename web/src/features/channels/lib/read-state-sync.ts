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
      if (typeof v === "number" && Number.isFinite(v) && v > 0) contexts[k] = v;
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
    ([k]) => !k.startsWith("msg:") && !k.startsWith("thread:"),
  );
}

/**
 * Serialize a slot, pruning OLDEST bare-channel markers first when over
 * budget. msg:/thread: keys are never pruned — they are other clients' data
 * we must carry. (Pruning is safe: merge is monotonic, so a pruned key
 * re-merges from the originating client's slot.)
 */
export function buildSlotPlaintext(
  clientId: string,
  contexts: Record<string, number>,
  budget = READ_STATE_BUDGET_BYTES,
): string {
  const encode = (ctx: Record<string, number>) =>
    JSON.stringify({ v: 1, client_id: clientId, contexts: ctx });
  let json = encode(contexts);
  if (json.length <= budget) return json;
  const prunable = channelMarkers(contexts)
    .sort((x, y) => x[1] - y[1])
    .map(([k]) => k);
  const working = { ...contexts };
  for (const key of prunable) {
    delete working[key];
    json = encode(working);
    if (json.length <= budget) return json;
  }
  return json;
}
