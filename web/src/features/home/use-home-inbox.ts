/**
 * Unified home inbox (desktop/mobile parity): folds mentions, threaded
 * replies, workflow approvals, and agent job activity — all scoped to events
 * addressing me (#p) or my DM channels — into conversation-grouped rows.
 *
 * Subscription contract (mirrors mobile's activity_provider):
 *   kinds 9/40002/1/1621/1618  #p [me]  — mentions, replies, project items
 *   kinds 46010-46012          #p [me]  — approval requested/approved/denied
 *   kinds 43001-43006          #p [me]  — agent job lifecycle
 *   kinds 9/40002              #h [dm channel ids] — untagged DM traffic
 * Pending reminders come from the existing useReminders hook.
 *
 * Own events are excluded everywhere (an inbox is what others send you).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useRelay } from "@/shared/context/relay-context";
import { KIND_STREAM_MSG, KIND_STREAM_MSG_V2 } from "../channels/types";
import { KIND_TEXT_NOTE } from "./use-pulse";
import { useChannels } from "../channels/use-channels";
import { useReminders } from "../reminders/use-reminders";
import type { NostrEvent } from "@/shared/lib/relay-connection";
import {
  buildInboxRows,
  type InboxItem,
  type InboxRow,
} from "./lib/inbox";

const KIND_ISSUE = 1621;
const KIND_PULL_REQUEST = 1618;
const KIND_APPROVAL_REQUESTED = 46010;
const KIND_APPROVAL_GRANTED = 46011;
const KIND_APPROVAL_DENIED = 46012;
const JOB_KINDS = [43001, 43002, 43003, 43004, 43005, 43006];
const MESSAGE_KINDS = [KIND_STREAM_MSG, KIND_STREAM_MSG_V2, KIND_TEXT_NOTE];

function rootRefOf(ev: NostrEvent): { rootId?: string; parentId?: string } {
  let rootId: string | undefined;
  let parentId: string | undefined;
  for (const t of ev.tags) {
    if (t[0] !== "e" && t[0] !== "E") continue;
    if (t[3] === "root" && !rootId) rootId = t[1];
    else if (t[3] === "reply") parentId = t[1];
    else if (!rootId) rootId = t[1];
  }
  return { rootId, parentId };
}

/**
 * Approval correlation key. Workflow run-status events (46010–46012) are
 * keyed by their `run` tag — they carry no NIP-10 e-root — so both the
 * request and its resolution must derive identity here or resolved approvals
 * never hide the pending row. Exported for tests.
 */
export function approvalRunKeyOf(ev: NostrEvent): string {
  return ev.tags.find((t) => t[0] === "run")?.[1] ?? rootRefOf(ev).rootId ?? ev.id;
}

function classify(ev: NostrEvent, channelType?: string, forceActivity = false): InboxItem | null {
  const channelId = ev.tags.find((t) => t[0] === "h")?.[1];
  const { rootId, parentId } = rootRefOf(ev);
  const base = {
    id: ev.id,
    kind: ev.kind,
    pubkey: ev.pubkey,
    content: ev.content,
    createdAt: ev.created_at,
    channelId,
    channelType,
    rootId,
    parentId,
  };

  if (ev.kind === KIND_APPROVAL_REQUESTED) {
    return { ...base, rootId: approvalRunKeyOf(ev), category: "needs_action" };
  }
  if (JOB_KINDS.includes(ev.kind)) {
    return { ...base, category: "agent_activity" };
  }
  if (ev.kind === KIND_ISSUE || ev.kind === KIND_PULL_REQUEST) {
    const repoAddress = ev.tags.find((t) => t[0] === "a")?.[1];
    return {
      ...base,
      rootId: ev.id,
      repoAddress,
      category: "mention",
    };
  }
  if (MESSAGE_KINDS.includes(ev.kind)) {
    // Thread replies (have a parent/root ref) are activity; bare p-tags are
    // mentions — desktop's isHomeActivityEvent distinction. Events from the
    // DM-only #h feed are always activity (mobile contract): an untagged DM
    // is not a mention.
    return {
      ...base,
      category: forceActivity || rootId || parentId ? "activity" : "mention",
    };
  }
  return null;
}

export function useHomeInbox(): { rows: InboxRow[]; isLoading: boolean } {
  const { connection, connectionState, identity } = useRelay();
  const myPubkey = identity?.pubkey;
  const { channels } = useChannels();
  const { reminders, isLoading: remindersLoading } = useReminders();
  const [items, setItems] = useState<InboxItem[]>([]);
  const [resolvedApprovals, setResolvedApprovals] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const itemsRef = useRef(new Map<string, InboxItem>());
  const resolvedRef = useRef(new Set<string>());

  const dmChannelIds = useMemo(
    () => channels.filter((c) => c.channelType === "dm").map((c) => c.groupId),
    [channels],
  );
  const dmChannelSet = useMemo(() => new Set(dmChannelIds), [dmChannelIds]);

  useEffect(() => {
    if (!connection || connectionState !== "ready" || !myPubkey) return;
    itemsRef.current = new Map();
    resolvedRef.current = new Set();
    setItems([]);
    setResolvedApprovals(new Set());
    setIsLoading(true);

    let eoseSeen = 0;
    const expectedEose = dmChannelIds.length > 0 ? 4 : 3;
    const onEose = () => {
      eoseSeen += 1;
      if (eoseSeen >= expectedEose) setIsLoading(false);
    };

    const push = (ev: NostrEvent, forceActivity = false) => {
      if (ev.pubkey === myPubkey) return;
      if (ev.kind === KIND_APPROVAL_GRANTED || ev.kind === KIND_APPROVAL_DENIED) {
        const root = approvalRunKeyOf(ev);
        if (!resolvedRef.current.has(root)) {
          resolvedRef.current.add(root);
          setResolvedApprovals(new Set(resolvedRef.current));
        }
        return;
      }
      const isDm = dmChannelSet.has(ev.tags.find((t) => t[0] === "h")?.[1] ?? "");
      const item = classify(ev, isDm ? "dm" : undefined, forceActivity);
      if (!item || itemsRef.current.has(ev.id)) return;
      itemsRef.current.set(ev.id, item);
      setItems([...itemsRef.current.values()]);
    };

    const unsubs = [
      connection.subscribe(
        { kinds: [...MESSAGE_KINDS, KIND_ISSUE, KIND_PULL_REQUEST], "#p": [myPubkey], limit: 100 },
        push,
        onEose,
      ),
      connection.subscribe(
        { kinds: [KIND_APPROVAL_REQUESTED, KIND_APPROVAL_GRANTED, KIND_APPROVAL_DENIED], "#p": [myPubkey], limit: 20 },
        push,
        onEose,
      ),
      connection.subscribe({ kinds: JOB_KINDS, "#p": [myPubkey], limit: 20 }, push, onEose),
    ];
    if (dmChannelIds.length > 0) {
      unsubs.push(
        connection.subscribe(
          { kinds: [KIND_STREAM_MSG, KIND_STREAM_MSG_V2], "#h": dmChannelIds, limit: 50 },
          (ev) => push(ev, true),
          onEose,
        ),
      );
    }

    return () => unsubs.forEach((u) => u());
  }, [connection, connectionState, myPubkey, dmChannelIds, dmChannelSet]);

  const rows = useMemo(() => {
    const visible = items.filter(
      (it) => it.category !== "needs_action" || !resolvedApprovals.has(it.rootId ?? it.id),
    );
    return buildInboxRows(visible, reminders);
  }, [items, resolvedApprovals, reminders]);

  return { rows, isLoading: isLoading || remindersLoading };
}
