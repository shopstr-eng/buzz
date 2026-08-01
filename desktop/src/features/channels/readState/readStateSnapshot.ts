import { nip44DecryptFromSelf } from "@/shared/api/tauri";
import type { RelayEvent } from "@/shared/api/types";
import {
  isValidBlob,
  isValidReadStateDTag,
  sanitizeContexts,
  type ReadStateBlob,
} from "@/features/channels/readState/readStateFormat";
import {
  mergeOverrides,
  splitContexts,
  type OverrideRegister,
} from "@/features/channels/readState/unreadOverride";

export type ReadStateDecrypt = (ciphertext: string) => Promise<string>;

export type ParsedReadStateEvent = {
  dTag: string;
  blob: ReadStateBlob;
  createdAt: number;
};

export async function parseReadStateEvent(
  event: RelayEvent,
  pubkey: string,
  decrypt: ReadStateDecrypt = nip44DecryptFromSelf,
): Promise<ParsedReadStateEvent | null> {
  if (event.pubkey !== pubkey) return null;

  const dTags = event.tags.filter((tag) => tag[0] === "d");
  if (dTags.length !== 1) return null;
  const dTag = dTags[0]?.[1];
  if (!isValidReadStateDTag(dTag)) return null;

  const tTags = event.tags.filter(
    (tag) => tag[0] === "t" && tag[1] === "read-state",
  );
  if (tTags.length !== 1) return null;

  try {
    const plaintext = await decrypt(event.content);
    const parsed = JSON.parse(plaintext);
    if (!isValidBlob(parsed)) return null;
    return {
      dTag,
      blob: {
        v: 1,
        client_id: parsed.client_id,
        contexts: sanitizeContexts(parsed.contexts),
      },
      createdAt: event.created_at,
    };
  } catch (error) {
    console.debug(
      `[ReadStateSnapshot] decrypt/parse failed event=${event.id.substring(0, 8)}…:`,
      error,
    );
    return null;
  }
}

export type MergedReadState = {
  /** Frontier entries keyed by RAW (unescaped) context ID, max-merged. */
  contexts: Map<string, number>;
  /** Validated ov_* override registers, componentwise-max merged. */
  overrides: Record<string, OverrideRegister>;
};

/**
 * Merge blobs into a frontier map plus override registers. ov_* groups are
 * validated group-first per NIP-RS (invalid groups dropped wholesale, the
 * frontier entry retained) and merged componentwise; frontier wire keys are
 * unescaped to raw context IDs.
 */
export async function mergeReadStateEventsWithOverrides(
  events: RelayEvent[],
  pubkey: string,
  decrypt?: ReadStateDecrypt,
): Promise<MergedReadState> {
  const contexts = new Map<string, number>();
  let overrides: Record<string, OverrideRegister> = {};

  for (const event of events) {
    const parsed = await parseReadStateEvent(event, pubkey, decrypt);
    if (!parsed) continue;

    const split = splitContexts(parsed.blob.contexts);
    for (const [contextId, timestamp] of Object.entries(split.frontier)) {
      const current = contexts.get(contextId) ?? 0;
      if (timestamp > current) {
        contexts.set(contextId, timestamp);
      }
    }
    overrides = mergeOverrides(overrides, split.overrides);
  }

  return { contexts, overrides };
}

export async function mergeReadStateEvents(
  events: RelayEvent[],
  pubkey: string,
  decrypt?: ReadStateDecrypt,
): Promise<Map<string, number>> {
  const merged = await mergeReadStateEventsWithOverrides(
    events,
    pubkey,
    decrypt,
  );
  return merged.contexts;
}

export function getSnapshotReadTimestamp(
  contexts: ReadonlyMap<string, number>,
  contextId: string,
): number | null {
  return contexts.get(contextId) ?? null;
}
