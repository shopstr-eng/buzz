/**
 * Reconciliation for addressable directory events (30175/30176/30177) plus
 * kind-5 tombstones. Pure — extracted from use-agents.ts for testability.
 *
 * Replaceable resolution mirrors relay/NIP-33 semantics: newest created_at
 * wins; same-second ties resolve deterministically by larger event id.
 * Kind-5 deletions tombstone an address at the delete's created_at; snapshots
 * at or before it are suppressed. This matters during replay, which can
 * deliver a delete BEFORE the older snapshot it removes — without tombstone
 * suppression the stale snapshot would resurrect the record.
 */

export class DirectoryStore<T> {
  private entries = new Map<string, { at: number; id: string; value: T }>();
  private tombstoneAt: number | null = null;

  /** Insert/replace a snapshot. Returns true when the visible set changed. */
  put(dTag: string, at: number, id: string, value: T): boolean {
    if (this.tombstoneAt !== null && at <= this.tombstoneAt) {
      // Tombstoned — suppress, and evict any copy that slipped in earlier.
      return this.entries.delete(dTag);
    }
    const existing = this.entries.get(dTag);
    if (existing && (existing.at > at || (existing.at === at && existing.id >= id))) {
      return false;
    }
    this.entries.set(dTag, { at, id, value });
    return true;
  }

  /** Apply a kind-5 tombstone for this store's kind. */
  tombstone(dTag: string, at: number): boolean {
    if (this.tombstoneAt === null || at > this.tombstoneAt) this.tombstoneAt = at;
    const existing = this.entries.get(dTag);
    if (existing && existing.at <= this.tombstoneAt) return this.entries.delete(dTag);
    return false;
  }

  values(): T[] {
    return [...this.entries.values()].map((e) => e.value);
  }
}
