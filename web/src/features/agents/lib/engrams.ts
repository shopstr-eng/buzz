/**
 * Pure helpers for agent memory engrams (kind 30174, NIP-AE). Decrypted
 * plaintext bodies:
 *   memory:    { "slug": "mem/...", "value": "text" | null }  (null = tombstone)
 *   core:      { "slug": "core", "profile": "text" }
 * The memory graph links bodies via wiki-links [[slug]]; the desktop builds a
 * reachability tree rooted at "core" — unreachable nodes are orphans, refs to
 * missing/tombstoned slugs are dangling.
 */

export interface EngramBody {
  slug: string;
  /** Memory text (null for core/tombstone). */
  value: string | null;
  /** Core profile text (null for memories). */
  profile: string | null;
}

export function parseEngramBody(plaintext: string): EngramBody | null {
  try {
    const parsed: unknown = JSON.parse(plaintext);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const p = parsed as Record<string, unknown>;
    if (typeof p.slug !== "string" || !p.slug) return null;
    if (p.slug === "core") {
      return typeof p.profile === "string" ? { slug: "core", value: null, profile: p.profile } : null;
    }
    if (p.value === null) return { slug: p.slug, value: null, profile: null };
    return typeof p.value === "string" ? { slug: p.slug, value: p.value, profile: null } : null;
  } catch {
    return null;
  }
}

/** Wiki-links [[slug]], deduped, in order of appearance. */
export function extractRefs(text: string): string[] {
  const refs: string[] = [];
  const re = /\[\[([^\[\]]+)\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const slug = m[1].trim();
    if (slug && !refs.includes(slug)) refs.push(slug);
  }
  return refs;
}

export interface EngramEntry {
  /** Event id of the current head. */
  id: string;
  agentPubkey: string;
  dTag: string;
  createdAt: number;
  body: EngramBody;
}

interface EngramEventLike {
  id: string;
  pubkey: string;
  created_at: number;
  tags: string[][];
}

/**
 * Head selection per (agent, d-tag): latest created_at wins, ties broken by
 * LOWEST event id (buzz-core engram.rs head rule).
 */
export class EngramStore {
  private heads = new Map<string, EngramEntry>();

  apply(ev: EngramEventLike, body: EngramBody): boolean {
    const dTag = ev.tags.find((t) => t[0] === "d")?.[1];
    if (!dTag) return false;
    const key = `${ev.pubkey}:${dTag}`;
    const existing = this.heads.get(key);
    if (
      existing &&
      (existing.createdAt > ev.created_at ||
        (existing.createdAt === ev.created_at && existing.id < ev.id))
    ) {
      return false;
    }
    this.heads.set(key, {
      id: ev.id,
      agentPubkey: ev.pubkey,
      dTag,
      createdAt: ev.created_at,
      body,
    });
    return true;
  }

  entries(): EngramEntry[] {
    return [...this.heads.values()];
  }
}

export interface MemoryGraphNode {
  slug: string;
  text: string;
  refs: string[];
}

export interface MemoryGraph {
  core: MemoryGraphNode | null;
  /** Slugs reachable from core via wiki-links (core included). */
  reachable: Map<string, MemoryGraphNode>;
  /** Live nodes NOT reachable from core. */
  orphans: MemoryGraphNode[];
  /** Refs pointing at missing or tombstoned slugs. */
  danglingRefs: string[];
}

/** Build the graph for ONE agent's engram entries (cycle-safe BFS). */
export function buildMemoryGraph(entries: EngramEntry[]): MemoryGraph {
  const nodes = new Map<string, MemoryGraphNode>();
  for (const e of entries) {
    const isTombstone = e.body.slug !== "core" && e.body.value === null;
    if (isTombstone) continue;
    const text = e.body.slug === "core" ? (e.body.profile ?? "") : (e.body.value ?? "");
    nodes.set(e.body.slug, { slug: e.body.slug, text, refs: extractRefs(text) });
  }

  const core = nodes.get("core") ?? null;
  const reachable = new Map<string, MemoryGraphNode>();
  const queue = core ? ["core"] : [];
  while (queue.length > 0) {
    const slug = queue.shift() as string;
    if (reachable.has(slug)) continue;
    const node = nodes.get(slug);
    if (!node) continue;
    reachable.set(slug, node);
    queue.push(...node.refs);
  }

  const orphans = [...nodes.values()].filter((n) => !reachable.has(n.slug));
  const dangling = new Set<string>();
  for (const n of nodes.values()) {
    for (const r of n.refs) if (!nodes.has(r)) dangling.add(r);
  }
  return { core, reachable, orphans, danglingRefs: [...dangling] };
}
