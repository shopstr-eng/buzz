/**
 * NIP-RS manual-unread override layer (docs/nips/NIP-RS.md — Manual-Unread
 * Override Layer). Pure helpers only; no IO. Desktop port of the reference
 * implementation in web/src/features/channels/lib/unread-override.ts — the
 * two files MUST stay semantically identical (same group-first validation,
 * clear-wins tie policy, canonical publication).
 *
 * Wire shape: per manually-unread context <ctx>, up to three sibling keys in
 * the contexts map — ov_s:<ctx> (set counter), ov_c:<ctx> (clear counter),
 * ov_b:<ctx> (baseline frontier at mark-unread time). Accepted wire shapes are
 * exactly (a) complete live 3-key group, or (b) tombstone floor (ov_c only).
 * Anything else rejects the WHOLE group (frontier entry retained) — groups are
 * validated as a unit BEFORE any decode/zero-fill/merge.
 *
 * Merge is componentwise max. Tie policy is clear-wins (normative).
 * Escaping: raw frontier context IDs beginning with "ov_" or "esc:" are
 * escaped with one "esc:" prefix on publish, and exactly one is stripped on
 * receive (bijection). ov_* key suffixes are RAW ctx ids, never escaped.
 */

export interface OverrideRegister {
  s: number;
  c: number;
  b: number;
}

export const OV_MAX = 4294967295; // uint32 max

function isU32(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= OV_MAX;
}

/** Escape a raw context ID for use as a frontier wire key (publish side). */
export function escapeFrontierKey(raw: string): string {
  return raw.startsWith("ov_") || raw.startsWith("esc:") ? `esc:${raw}` : raw;
}

/** Strip exactly one leading "esc:" from a frontier wire key (receive side). */
export function unescapeFrontierKey(wire: string): string {
  return wire.startsWith("esc:") ? wire.slice(4) : wire;
}

export interface SplitContexts {
  /** Frontier entries keyed by RAW (unescaped) context ID. */
  frontier: Record<string, number>;
  /** Validated override registers keyed by raw context ID. */
  overrides: Record<string, OverrideRegister>;
}

/**
 * Split a raw wire `contexts` map into frontier entries and validated
 * override registers. Group-first validation per the NIP: collect all ov_*
 * siblings per <ctx> BEFORE accepting/rejecting; invalid groups are dropped
 * wholesale while the context's frontier entry is retained.
 */
export function splitContexts(wire: Record<string, number>): SplitContexts {
  const frontier: Record<string, number> = {};
  const groups = new Map<
    string,
    Partial<Record<"s" | "c" | "b", number>> & { bad?: boolean }
  >();

  for (const [key, value] of Object.entries(wire)) {
    const m = /^ov_([scb]):/.exec(key);
    if (m) {
      const ctx = key.slice(5);
      const g = groups.get(ctx) ?? {};
      const comp = m[1] as "s" | "c" | "b";
      if (g[comp] !== undefined || !isU32(value)) g.bad = true;
      else g[comp] = value;
      groups.set(ctx, g);
      continue;
    }
    if (key.startsWith("ov_")) continue; // reserved stem, unknown shape — drop
    // Frontier entry: keep positive finite timestamps only (existing rule).
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      const raw = unescapeFrontierKey(key);
      if ((frontier[raw] ?? 0) < value) frontier[raw] = value;
    }
  }

  const overrides: Record<string, OverrideRegister> = {};
  for (const [ctx, g] of groups) {
    if (g.bad) continue;
    const has = (k: "s" | "c" | "b") => g[k] !== undefined;
    if (has("s") && has("c") && has("b")) {
      overrides[ctx] = {
        s: g.s as number,
        c: g.c as number,
        b: g.b as number,
      };
    } else if (!has("s") && !has("b") && has("c")) {
      overrides[ctx] = { s: 0, c: g.c as number, b: 0 }; // tombstone floor
    }
    // any other shape: reject the whole group (frontier already retained)
  }
  return { frontier, overrides };
}

/** Componentwise max() merge of two override registers. */
export function mergeRegister(
  a: OverrideRegister,
  b: OverrideRegister,
): OverrideRegister {
  return {
    s: Math.max(a.s, b.s),
    c: Math.max(a.c, b.c),
    b: Math.max(a.b, b.b),
  };
}

/** Merge two override maps (componentwise max per context). */
export function mergeOverrides(
  a: Record<string, OverrideRegister>,
  b: Record<string, OverrideRegister>,
): Record<string, OverrideRegister> {
  const out: Record<string, OverrideRegister> = { ...a };
  for (const [ctx, reg] of Object.entries(b)) {
    out[ctx] = out[ctx] ? mergeRegister(out[ctx], reg) : reg;
  }
  return out;
}

/** Liveness predicate (clear-wins tie policy — normative). */
export function overrideActive(
  reg: OverrideRegister,
  frontier: number,
): boolean {
  return reg.s > 0 && frontier <= reg.b && reg.s > reg.c;
}

/**
 * Mark-unread action: S = max(S, C) + 1, B = current effective frontier.
 * Returns null when the counter ceiling (uint32 max) is reached — the action
 * MUST be refused, never wrapped or reset.
 */
export function markUnreadRegister(
  reg: OverrideRegister | undefined,
  frontier: number,
): OverrideRegister | null {
  const base = reg ?? { s: 0, c: 0, b: 0 };
  const top = Math.max(base.s, base.c);
  if (top >= OV_MAX) return null;
  return { s: top + 1, c: base.c, b: frontier };
}

export interface MarkUnreadPlan {
  overrides: Record<string, OverrideRegister>;
  frontier: Record<string, number>;
  register: OverrideRegister;
}

/**
 * Plan a mark-unread action against the FULL effective frontier: the merged
 * wire frontier max-merged with local read markers that may not have been
 * published yet (debounce window). The baseline B MUST come from this merged
 * frontier — a B taken from the wire frontier alone can be below the local
 * marker, making the register dead on arrival (F > B at canonicalization)
 * so only a tombstone would publish and remote devices would never see the
 * force. Returns null at the counter ceiling (action must be refused).
 */
export function planMarkUnread(
  overrides: Record<string, OverrideRegister>,
  frontier: Record<string, number>,
  localMarkers: Record<string, number>,
  ctx: string,
): MarkUnreadPlan | null {
  const candidateFrontier: Record<string, number> = { ...frontier };
  for (const [k, v] of Object.entries(localMarkers)) {
    if ((candidateFrontier[k] ?? 0) < v) candidateFrontier[k] = v;
  }
  const register = markUnreadRegister(
    overrides[ctx],
    candidateFrontier[ctx] ?? 0,
  );
  if (!register) return null;
  return {
    overrides: { ...overrides, [ctx]: register },
    frontier: candidateFrontier,
    register,
  };
}

/**
 * Explicit mark-read action: C = max(S, C) + 1 (S and B unchanged).
 * Returns null at the counter ceiling. No-op passthrough for virgin registers.
 */
export function markReadRegister(
  reg: OverrideRegister,
): OverrideRegister | null {
  if (reg.s === 0 && reg.c === 0) return reg;
  const top = Math.max(reg.s, reg.c);
  if (top >= OV_MAX) return null;
  return { s: reg.s, c: top + 1, b: reg.b };
}

/**
 * Mandatory canonical publication: serialize override registers to wire
 * entries against the effective frontier. Live → all three keys; dead
 * (ever-active) → tombstone floor (single ov_c = max(S, C)); virgin → omitted.
 */
export function canonicalWireEntries(
  overrides: Record<string, OverrideRegister>,
  frontier: Record<string, number>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [ctx, reg] of Object.entries(overrides)) {
    if (reg.s === 0 && reg.c === 0) continue; // virgin — omit
    const f = frontier[ctx] ?? 0;
    if (overrideActive(reg, f)) {
      out[`ov_s:${ctx}`] = reg.s;
      out[`ov_c:${ctx}`] = reg.c;
      out[`ov_b:${ctx}`] = reg.b;
    } else {
      out[`ov_c:${ctx}`] = Math.max(reg.s, reg.c); // tombstone floor
    }
  }
  return out;
}
