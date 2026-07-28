/**
 * Event reminders (kind 30300, NIP-ER), mirroring the desktop client:
 *   tags: ["d", uuid], ["not_before", unix_ts]
 *   content: NIP-44-to-self encrypted JSON
 *     { status: "pending"|"done"|"cancelled", note?, target?: {eventId, channelId, preview, authorPubkey} }
 */

import { useCallback, useEffect, useState } from "react";
import { useRelay } from "@/shared/context/relay-context";
import { getSignFn } from "@/shared/lib/identity";
import { getNip44SelfAsync } from "@/shared/lib/nip44-self";
import type { NostrEvent } from "@/shared/lib/relay-connection";

export const KIND_EVENT_REMINDER = 30300;

export interface ReminderTarget {
  eventId?: string;
  channelId?: string;
  preview?: string;
  authorPubkey?: string;
}

export interface Reminder {
  dTag: string;
  status: "pending" | "done" | "cancelled";
  note: string;
  target?: ReminderTarget;
  notBefore: number;
  createdAt: number;
}

interface ReminderPayload {
  status?: string;
  note?: string;
  target?: ReminderTarget;
}

/** Whether reminders are available (needs NIP-44: nsec login or capable extension). */
export async function remindersSupported(): Promise<boolean> {
  return (await getNip44SelfAsync()) !== null;
}

/** Standalone creator (no subscription) for the "Remind me" message action. */
export function useAddReminder(): (
  note: string,
  target: ReminderTarget | undefined,
  notBefore: number,
) => Promise<void> {
  const { connection } = useRelay();
  return useCallback(
    async (note, target, notBefore) => {
      if (!connection) return;
      const signFn = getSignFn();
      const nip = await getNip44SelfAsync();
      if (!signFn || !nip) throw new Error("Reminders require a key login (nsec or NIP-44 extension).");
      const signed = await signFn({
        kind: KIND_EVENT_REMINDER,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ["d", crypto.randomUUID()],
          ["not_before", String(Math.floor(notBefore))],
        ],
        content: await nip.encrypt(JSON.stringify({ status: "pending", note, ...(target ? { target } : {}) })),
      });
      connection.publish(signed);
    },
    [connection],
  );
}

export function useReminders(): {
  reminders: Reminder[];
  isLoading: boolean;
  supported: boolean | null;
  addReminder: (note: string, target: ReminderTarget | undefined, notBefore: number) => Promise<void>;
  setStatus: (reminder: Reminder, status: "done" | "cancelled") => Promise<void>;
} {
  const { connection, connectionState, identity } = useRelay();
  const myPubkey = identity?.pubkey;
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [supported, setSupported] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getNip44SelfAsync().then((nip) => {
      if (!cancelled) setSupported(nip !== null);
    });
    return () => {
      cancelled = true;
    };
  }, [myPubkey]);

  useEffect(() => {
    if (!connection || connectionState !== "ready" || !myPubkey) return;
    let cancelled = false;
    setReminders([]);
    setIsLoading(true);

    const byTag = new Map<string, Reminder>();

    const unsub = connection.subscribe(
      { kinds: [KIND_EVENT_REMINDER], authors: [myPubkey], limit: 500 },
      (ev: NostrEvent) => {
        void (async () => {
          const dTag = ev.tags.find((t) => t[0] === "d")?.[1];
          if (!dTag) return;
          const existing = byTag.get(dTag);
          if (existing && existing.createdAt >= ev.created_at) return;

          const nip = await getNip44SelfAsync();
          if (!nip || cancelled) return;

          let payload: ReminderPayload;
          try {
            payload = JSON.parse(await nip.decrypt(ev.content)) as ReminderPayload;
          } catch {
            return; // undecryptable / malformed — skip
          }

          // Re-check after the async decrypt: a NEWER version of this reminder
          // may have been applied while we were awaiting. Latest always wins.
          const latest = byTag.get(dTag);
          if (latest && latest.createdAt >= ev.created_at) return;

          const notBefore = Number(ev.tags.find((t) => t[0] === "not_before")?.[1] ?? 0);
          byTag.set(dTag, {
            dTag,
            status: payload.status === "done" || payload.status === "cancelled" ? payload.status : "pending",
            note: payload.note ?? payload.target?.preview ?? "",
            target: payload.target,
            notBefore,
            createdAt: ev.created_at,
          });
          if (!cancelled) {
            setReminders([...byTag.values()].sort((a, b) => a.notBefore - b.notBefore));
          }
        })();
      },
      () => setIsLoading(false),
    );

    return () => {
      cancelled = true;
      unsub();
    };
  }, [connection, connectionState, myPubkey]);

  const publishReminder = useCallback(
    async (dTag: string, payload: ReminderPayload, notBefore: number) => {
      if (!connection) return;
      const signFn = getSignFn();
      const nip = await getNip44SelfAsync();
      if (!signFn || !nip) throw new Error("Reminders require a key login (nsec or NIP-44 extension).");
      const signed = await signFn({
        kind: KIND_EVENT_REMINDER,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ["d", dTag],
          ["not_before", String(Math.floor(notBefore))],
        ],
        content: await nip.encrypt(JSON.stringify(payload)),
      });
      connection.publish(signed);
    },
    [connection],
  );

  const addReminder = useCallback(
    async (note: string, target: ReminderTarget | undefined, notBefore: number) => {
      await publishReminder(
        crypto.randomUUID(),
        { status: "pending", note, ...(target ? { target } : {}) },
        notBefore,
      );
    },
    [publishReminder],
  );

  const setStatus = useCallback(
    async (reminder: Reminder, status: "done" | "cancelled") => {
      await publishReminder(
        reminder.dTag,
        { status, note: reminder.note, ...(reminder.target ? { target: reminder.target } : {}) },
        reminder.notBefore,
      );
    },
    [publishReminder],
  );

  return { reminders, isLoading, supported, addReminder, setStatus };
}
