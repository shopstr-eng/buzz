/**
 * Channel moderation (NIP-56 + Buzz moderation commands), tag shapes pinned
 * by the desktop client + relay moderation_commands.rs:
 *   1984 report:        [["p", author], ["e", eventId, reportType]], content = note
 *   9040 ban:           [["p", pk]] (+ ["expiration", ts], ["reason", text])
 *   9041 unban:         [["p", pk]]
 *   9042 timeout:       [["p", pk], ["expiration", ts]] (+ ["reason", text])
 *   9043 untimeout:     [["p", pk]]
 * Community-scoped (no h tag). The relay enforces admin authz server-side.
 * The mod queue itself is NOT relay-readable (reports suppress fanout), so
 * report resolution stays desktop-only.
 */

import { useCallback } from "react";
import { useRelay } from "@/shared/context/relay-context";
import { getSignFn } from "@/shared/lib/identity";

export const KIND_REPORT = 1984;
export const KIND_MODERATION_BAN = 9040;
export const KIND_MODERATION_UNBAN = 9041;
export const KIND_MODERATION_TIMEOUT = 9042;
export const KIND_MODERATION_UNTIMEOUT = 9043;

export const REPORT_TYPES = [
  { value: "spam", label: "Spam" },
  { value: "illegal", label: "Illegal content" },
  { value: "nudity", label: "Nudity" },
  { value: "malware", label: "Malware" },
  { value: "impersonation", label: "Impersonation" },
  { value: "profanity", label: "Profanity" },
  { value: "other", label: "Other" },
] as const;
export type ReportType = (typeof REPORT_TYPES)[number]["value"];

export const TIMEOUT_PRESETS = [
  { label: "1 hour", seconds: 60 * 60 },
  { label: "24 hours", seconds: 24 * 60 * 60 },
  { label: "7 days", seconds: 7 * 24 * 60 * 60 },
] as const;

/** Relay send-rejection prefix for community timeouts (load-bearing). */
const TIMEOUT_PREFIX = "restricted: you are timed out until";

export interface TimeoutRejection {
  /** Expiry in epoch ms, or null when unparseable (still timed out). */
  expiresAtMs: number | null;
}

/** Parse a relay rejection message; null when it's not a timeout refusal. */
export function parseTimeoutRejection(message: string): TimeoutRejection | null {
  const trimmed = message.trim();
  if (!trimmed.startsWith(TIMEOUT_PREFIX)) return null;
  const secs = Number(trimmed.slice(TIMEOUT_PREFIX.length).trim());
  return { expiresAtMs: Number.isFinite(secs) && secs > 0 ? secs * 1000 : null };
}

export function useModeration(): {
  submitReport: (authorPubkey: string, eventId: string, reportType: ReportType, note?: string) => Promise<void>;
  banMember: (pubkey: string, reason?: string) => Promise<void>;
  unbanMember: (pubkey: string) => Promise<void>;
  timeoutMember: (pubkey: string, seconds: number, reason?: string) => Promise<void>;
  untimeoutMember: (pubkey: string) => Promise<void>;
} {
  const { connection } = useRelay();

  const publish = useCallback(
    async (kind: number, tags: string[][], content = "") => {
      if (!connection) throw new Error("Not connected to the relay.");
      const signFn = getSignFn();
      if (!signFn) throw new Error("No signing key available. Please log in again.");
      const signed = await signFn({
        kind,
        created_at: Math.floor(Date.now() / 1000),
        tags,
        content,
      });
      // Moderation commands are relay-validated — surface rejections.
      await connection.publishAndWait(signed);
    },
    [connection],
  );

  const submitReport = useCallback(
    (authorPubkey: string, eventId: string, reportType: ReportType, note?: string) =>
      publish(
        KIND_REPORT,
        [
          ["p", authorPubkey.toLowerCase()],
          ["e", eventId, reportType],
        ],
        note?.trim() ?? "",
      ),
    [publish],
  );

  const banMember = useCallback(
    (pubkey: string, reason?: string) => {
      const tags: string[][] = [["p", pubkey.toLowerCase()]];
      if (reason?.trim()) tags.push(["reason", reason.trim()]);
      return publish(KIND_MODERATION_BAN, tags);
    },
    [publish],
  );

  const unbanMember = useCallback(
    (pubkey: string) => publish(KIND_MODERATION_UNBAN, [["p", pubkey.toLowerCase()]]),
    [publish],
  );

  const timeoutMember = useCallback(
    (pubkey: string, seconds: number, reason?: string) => {
      const expiresAt = Math.floor(Date.now() / 1000) + seconds;
      const tags: string[][] = [
        ["p", pubkey.toLowerCase()],
        ["expiration", String(expiresAt)],
      ];
      if (reason?.trim()) tags.push(["reason", reason.trim()]);
      return publish(KIND_MODERATION_TIMEOUT, tags);
    },
    [publish],
  );

  const untimeoutMember = useCallback(
    (pubkey: string) => publish(KIND_MODERATION_UNTIMEOUT, [["p", pubkey.toLowerCase()]]),
    [publish],
  );

  return { submitReport, banMember, unbanMember, timeoutMember, untimeoutMember };
}
