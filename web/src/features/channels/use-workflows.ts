/**
 * Subscribe to kind:30620 workflow definition events for a channel and expose
 * a publish helper.
 *
 * kind:30620 is a NIP-33 parameterised replaceable event:
 *   - `["h", channelId]` — channel scope
 *   - `["d", workflowUuid]` — unique workflow ID (latest event per d-tag wins)
 *   - `["name", workflowName]` — human-readable name mirrored from YAML
 *   - content — raw YAML workflow definition
 */

import { useEffect, useState, useCallback } from "react";
import { useRelay } from "@/shared/context/relay-context";
import { getSignFn } from "@/shared/lib/identity";
import type { NostrEvent } from "@/shared/lib/relay-connection";

export const KIND_WORKFLOW_DEF = 30620;

export interface WorkflowDef {
  /** NIP-33 `d` tag — stable workflow UUID across updates. */
  workflowId: string;
  name: string;
  /** Raw YAML content. */
  yaml: string;
  pubkey: string;
  createdAt: number;
  /** Nostr event ID of the latest definition event — used for NIP-09 deletion. */
  eventId: string;
}

function eventToWorkflow(ev: NostrEvent): WorkflowDef | null {
  const workflowId = ev.tags.find((t) => t[0] === "d")?.[1];
  if (!workflowId) return null;
  const name =
    ev.tags.find((t) => t[0] === "name")?.[1] ??
    (ev.content.split("\n")[0].replace(/^name:\s*/i, "").trim() ||
      "Unnamed workflow");
  return {
    workflowId,
    name,
    yaml: ev.content,
    pubkey: ev.pubkey,
    createdAt: ev.created_at,
    eventId: ev.id,
  };
}

export function useWorkflows(groupId: string | null): {
  workflows: WorkflowDef[];
  isLoading: boolean;
  publishWorkflow: (name: string, yaml: string, existingId?: string) => Promise<string>;
  deleteWorkflow: (workflow: WorkflowDef) => Promise<void>;
  error: string | null;
} {
  const { connection, connectionState } = useRelay();
  const [workflows, setWorkflows] = useState<WorkflowDef[]>([]);
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());
  const [eoseReceived, setEoseReceived] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!connection || connectionState !== "ready" || !groupId) return;

    setWorkflows([]);
    setEoseReceived(false);

    // NIP-33: keep only the latest event per d-tag (workflow UUID).
    const seen = new Map<string, NostrEvent>();

    const unsub = connection.subscribe(
      { kinds: [KIND_WORKFLOW_DEF], "#h": [groupId], limit: 100 },
      (ev) => {
        const wfId = ev.tags.find((t) => t[0] === "d")?.[1];
        if (!wfId) return;
        const existing = seen.get(wfId);
        if (!existing || ev.created_at > existing.created_at) {
          seen.set(wfId, ev);
          setWorkflows(
            Array.from(seen.values())
              .map(eventToWorkflow)
              .filter((w): w is WorkflowDef => w !== null)
              .sort((a, b) => b.createdAt - a.createdAt),
          );
        }
      },
      () => setEoseReceived(true),
    );

    return unsub;
  }, [connection, connectionState, groupId]);

  const publishWorkflow = useCallback(
    async (name: string, yaml: string, existingId?: string): Promise<string> => {
      if (!connection || !groupId) throw new Error("Not connected to relay.");
      const signFn = getSignFn();
      if (!signFn) throw new Error("No signing key available.");

      // crypto.randomUUID() is available in all modern browsers and produces
      // a proper RFC-4122 UUID that the relay's d-tag validation accepts.
      const workflowId = existingId ?? crypto.randomUUID();

      const signed = await signFn({
        kind: KIND_WORKFLOW_DEF,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ["h", groupId],
          ["d", workflowId],
          ["name", name.trim()],
        ],
        content: yaml,
      });

      connection.publish(signed);
      setError(null);
      return workflowId;
    },
    [connection, groupId],
  );

  const deleteWorkflow = useCallback(
    async (workflow: WorkflowDef): Promise<void> => {
      if (!connection || !groupId) throw new Error("Not connected to relay.");
      const signFn = getSignFn();
      if (!signFn) throw new Error("No signing key available.");

      // NIP-09 deletion event (kind:5) with:
      //   - `e` tag pointing to the specific event ID
      //   - `a` tag pointing to the NIP-33 coordinate so the relay can
      //     mark the replaceable event deleted as well
      const coordinate = `${KIND_WORKFLOW_DEF}:${workflow.pubkey}:${workflow.workflowId}`;
      const signed = await signFn({
        kind: 5,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ["e", workflow.eventId],
          ["a", coordinate],
          ["h", groupId],
        ],
        content: "deleted",
      });

      connection.publish(signed);

      // Optimistically remove from local state immediately so the UI updates
      // without waiting for a relay round-trip.
      setDeletedIds((prev) => new Set([...prev, workflow.workflowId]));
      setError(null);
    },
    [connection, groupId],
  );

  const visibleWorkflows = workflows.filter((w) => !deletedIds.has(w.workflowId));

  return { workflows: visibleWorkflows, isLoading: !eoseReceived, publishWorkflow, deleteWorkflow, error };
}
