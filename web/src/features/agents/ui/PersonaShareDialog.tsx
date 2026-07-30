/**
 * Share dialog for a persona — web parity with desktop's redesigned
 * PersonaShareDialog (upstream #3699):
 *
 * - Catalog sharing is a dedicated toggle here (moved out of the edit
 *   dialog). It republishes the persona with/without ["shared","true"] via
 *   the existing kind:30175 contract — the wire format is unchanged.
 * - "What's included" memory levels (agent only / + core / + all memories)
 *   bundle the linked agent's decrypted engrams into the exported
 *   .agent.json, matching desktop's export semantics.
 * - DM-send and copy-link upload the snapshot to the relay's Blossom media
 *   endpoint (kind:24242 auth) and either send it as a file attachment in a
 *   DM (kind 9 + NIP-92 imeta, matching desktop's imeta markdown) or copy
 *   the blob URL.
 * - Memory-bearing exports/sends/links require an explicit plaintext-memory
 *   confirm.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, BookUser, Check, Download, Link2, Send, X } from "lucide-react";
import { useRelay } from "@/shared/context/relay-context";
import { getSignFn } from "@/shared/lib/identity";
import { uploadMediaBytes, type BlobDescriptor } from "@/shared/lib/blossom-upload";
import { buildImetaTags, formatImetaMediaLine } from "@/shared/lib/imeta-media";
import { useChannels } from "../../channels/use-channels";
import { KIND_STREAM_MSG, type Channel } from "../../channels/types";
import { findDmChannel, useOpenDm } from "../../dms/use-open-dm";
import { useCommunityPeople, type CommunityPerson } from "../../dms/use-community-people";
import type { AgentPersona } from "../use-agents";
import type { MemoryGraph } from "../lib/engrams";
import {
  buildSnapshot,
  selectMemoryEntries,
  type SnapshotMemoryLevel,
} from "../lib/agent-snapshot";
import { AgentDialogShell, DialogError, labelCls, inputCls } from "./agent-dialog-shell";

const SHARE_LEVELS: { value: SnapshotMemoryLevel; label: string }[] = [
  { value: "none", label: "Agent only" },
  { value: "core", label: "Agent + core memory" },
  { value: "everything", label: "Agent + all memories" },
];

/** How long to wait for the relay to create a fresh DM channel. */
const DM_RESOLVE_TIMEOUT_MS = 10_000;
const DM_RESOLVE_POLL_MS = 250;
const COPY_FEEDBACK_RESET_MS = 1500;
const MAX_RECIPIENTS = 8;

type SendPhase = "idle" | "uploading" | "sending" | "done";
type CopyStatus = "idle" | "copying" | "copied";

function formatRecipientAudience(names: readonly string[]): string {
  if (names.length === 0) return "The people you selected";
  if (names.length === 1) return names[0] ?? "The person you selected";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

/**
 * Desktop-parity plaintext-memory confirm. Link shares warn about anyone
 * with the link; DM sends name the recipients (plus anyone with the file
 * link). Returns true when the user confirms or no memory is included.
 */
function confirmMemoryShare(
  level: SnapshotMemoryLevel,
  action: "export" | "copy" | "send",
  recipientNames: readonly string[],
): boolean {
  if (level === "none") return true;
  const memoryLabel = level === "core" ? "core memory" : "all memories";
  const audience =
    action === "copy"
      ? "Anyone with the link can view it."
      : action === "send"
        ? `${formatRecipientAudience(recipientNames)}—and anyone with the file link—can view it.`
        : "Anyone with the file can read it.";
  return window.confirm(
    `Share memories?\n\nThis agent snapshot includes plaintext ${memoryLabel}. ` +
      `${audience} Only share with people you trust.`,
  );
}

export function PersonaShareDialog({
  persona,
  memoryGraph,
  isPublishing,
  publishError,
  onCatalogSharedChange,
  onClose,
}: {
  persona: AgentPersona;
  /** Linked agent's decrypted memory graph; null when no linked agent / no nip44. */
  memoryGraph: MemoryGraph | null;
  isPublishing: boolean;
  publishError: string | null;
  /** Republishes the persona with the shared tag flipped (kind:30175 contract). */
  onCatalogSharedChange: (shared: boolean) => void;
  onClose: () => void;
}) {
  const { connection, identity } = useRelay();
  const { channels } = useChannels();
  const { openDm } = useOpenDm();
  const people = useCommunityPeople();

  const [shareLevel, setShareLevel] = useState<SnapshotMemoryLevel>("none");
  const [recipients, setRecipients] = useState<CommunityPerson[]>([]);
  const [search, setSearch] = useState("");
  const [sendPhase, setSendPhase] = useState<SendPhase>("idle");
  const [copyStatus, setCopyStatus] = useState<CopyStatus>("idle");
  const [actionError, setActionError] = useState<string | null>(null);

  // Latest channels for the post-openDm resolver, without re-running it.
  const channelsRef = useRef<Channel[]>(channels);
  channelsRef.current = channels;
  // Single-concurrency guard across upload/copy/send.
  const inFlightRef = useRef(false);

  const hasMemoryOptions =
    memoryGraph !== null &&
    (memoryGraph.core !== null || memoryGraph.reachable.size > 0 || memoryGraph.orphans.length > 0);
  const effectiveLevel = hasMemoryOptions ? shareLevel : "none";

  const isSending = sendPhase === "uploading" || sendPhase === "sending";
  const isActionPending = isPublishing || isSending || copyStatus === "copying";

  const selectedPubkeys = useMemo(
    () => new Set(recipients.map((r) => r.pubkey)),
    [recipients],
  );
  const filteredPeople = people
    .filter((p) => {
      if (p.pubkey === identity?.pubkey || selectedPubkeys.has(p.pubkey)) return false;
      const q = search.trim().toLowerCase();
      return !q || p.name.toLowerCase().includes(q) || p.pubkey.startsWith(q);
    })
    .slice(0, 20);

  useEffect(() => {
    if (copyStatus !== "copied") return;
    const t = window.setTimeout(() => setCopyStatus("idle"), COPY_FEEDBACK_RESET_MS);
    return () => window.clearTimeout(t);
  }, [copyStatus]);

  /** Encode the snapshot at the chosen memory level as .agent.json bytes. */
  function encodeSnapshot(level: SnapshotMemoryLevel): { bytes: Uint8Array; fileName: string } {
    const entries = memoryGraph ? selectMemoryEntries(memoryGraph, level) : [];
    const snapshot = buildSnapshot(persona, { level, entries });
    return {
      bytes: new TextEncoder().encode(JSON.stringify(snapshot, null, 2)),
      fileName: `${persona.id}.agent.json`,
    };
  }

  async function uploadSnapshot(level: SnapshotMemoryLevel): Promise<BlobDescriptor> {
    const { bytes, fileName } = encodeSnapshot(level);
    return uploadMediaBytes(bytes, fileName, "application/json");
  }

  /** Download a .agent.json snapshot at the chosen memory level. */
  function handleExport(): void {
    if (!confirmMemoryShare(effectiveLevel, "export", [])) return;
    const { bytes, fileName } = encodeSnapshot(effectiveLevel);
    const blob = new Blob([bytes.slice().buffer], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  }

  /** Upload the snapshot and copy its blob URL to the clipboard. */
  async function handleCopyLink(): Promise<void> {
    if (inFlightRef.current || isActionPending) return;
    if (!confirmMemoryShare(effectiveLevel, "copy", [])) return;

    inFlightRef.current = true;
    setActionError(null);
    setCopyStatus("copying");
    try {
      const uploaded = await uploadSnapshot(effectiveLevel);
      await navigator.clipboard.writeText(uploaded.url);
      setCopyStatus("copied");
    } catch (err) {
      setCopyStatus("idle");
      setActionError(
        err instanceof Error ? `Couldn’t copy link: ${err.message}` : "Couldn’t copy link.",
      );
    } finally {
      inFlightRef.current = false;
    }
  }

  /**
   * Find the DM channel for the selected recipients, opening a new one
   * (kind 41010) and waiting for its discovery (kind 39000) if needed.
   */
  async function resolveDmChannel(pubkeys: string[]): Promise<Channel> {
    if (!identity) throw new Error("Not signed in.");
    const fullSet = new Set([identity.pubkey, ...pubkeys]);

    const existing = findDmChannel(channelsRef.current, fullSet);
    if (existing) return existing;

    const published = await openDm(pubkeys);
    if (!published) throw new Error("Couldn’t open the conversation.");

    const deadline = Date.now() + DM_RESOLVE_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const found = findDmChannel(channelsRef.current, fullSet);
      if (found) return found;
      await new Promise((r) => setTimeout(r, DM_RESOLVE_POLL_MS));
    }
    throw new Error("Timed out waiting for the relay to create the conversation.");
  }

  /**
   * Upload the snapshot, then send it as a file attachment in a DM with the
   * selected recipients — kind 9 with an h tag plus a NIP-92 imeta tag, and
   * content carrying desktop's imeta markdown file-link line.
   */
  async function handleSend(): Promise<void> {
    if (inFlightRef.current || isActionPending || recipients.length === 0) return;
    if (!connection || !identity) {
      setActionError("Not connected to the relay.");
      return;
    }
    if (!confirmMemoryShare(effectiveLevel, "send", recipients.map((r) => r.name))) return;

    const signFn = getSignFn();
    if (!signFn) {
      setActionError("No signing key available. Please log in again.");
      return;
    }

    inFlightRef.current = true;
    setActionError(null);
    setSendPhase("uploading");
    try {
      const uploaded = await uploadSnapshot(effectiveLevel);
      const channel = await resolveDmChannel(recipients.map((r) => r.pubkey));

      setSendPhase("sending");
      const content = formatImetaMediaLine(uploaded, { label: persona.displayName });
      const signed = await signFn({
        kind: KIND_STREAM_MSG,
        created_at: Math.floor(Date.now() / 1000),
        tags: [["h", channel.groupId], ...buildImetaTags([uploaded])],
        content,
      });
      await connection.publishAndWait(signed);

      setSendPhase("done");
      onClose();
    } catch (err) {
      setSendPhase("idle");
      setActionError(
        err instanceof Error ? `Couldn’t send agent: ${err.message}` : "Couldn’t send agent.",
      );
    } finally {
      inFlightRef.current = false;
    }
  }

  function addRecipient(person: CommunityPerson): void {
    if (recipients.length >= MAX_RECIPIENTS) return;
    setRecipients((prev) =>
      prev.some((r) => r.pubkey === person.pubkey) ? prev : [...prev, person],
    );
    setSearch("");
  }

  const copyLabel =
    copyStatus === "copying" ? "Copying…" : copyStatus === "copied" ? "Copied" : "Copy link";

  return (
    <AgentDialogShell title={`Share ${persona.displayName}`} onClose={onClose}>
      <div className="space-y-4 p-5">
        <DialogError message={publishError} />
        <DialogError message={actionError} />
        <p className="text-xs text-black/50 dark:text-white/50">
          Anyone you share this agent with receives a copy they can add and use.
          Changes you make later won’t sync.
        </p>

        <div data-testid="persona-share-recipients">
          <label className={labelCls} htmlFor="persona-share-recipient-search">
            Send to
          </label>
          {recipients.length > 0 && (
            <div className="mb-1.5 flex flex-wrap gap-1">
              {recipients.map((r) => (
                <span
                  key={r.pubkey}
                  className="flex items-center gap-1 rounded-full bg-black/8 px-2 py-0.5 text-xs text-black/70 dark:bg-white/12 dark:text-white/70"
                  data-testid={`persona-share-recipient-${r.pubkey.slice(0, 8)}`}
                >
                  {r.name}
                  <button
                    type="button"
                    aria-label={`Remove ${r.name}`}
                    disabled={isActionPending}
                    onClick={() =>
                      setRecipients((prev) => prev.filter((p) => p.pubkey !== r.pubkey))
                    }
                    className="text-black/40 hover:text-black/70 dark:text-white/40 dark:hover:text-white/70"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
          <input
            id="persona-share-recipient-search"
            type="text"
            className={inputCls}
            value={search}
            disabled={isActionPending || recipients.length >= MAX_RECIPIENTS}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={
              recipients.length >= MAX_RECIPIENTS
                ? `Up to ${MAX_RECIPIENTS} people`
                : "Search people…"
            }
            data-testid="persona-share-recipient-search"
          />
          {search.trim() && (
            <div className="mt-1 max-h-32 space-y-0.5 overflow-y-auto rounded-lg border border-black/8 p-1 dark:border-white/8">
              {filteredPeople.length === 0 ? (
                <p className="py-1.5 text-center text-[10px] text-black/35 dark:text-white/35">
                  {people.length === 0 ? "Loading people…" : "No matches."}
                </p>
              ) : (
                filteredPeople.map((p) => (
                  <button
                    key={p.pubkey}
                    type="button"
                    onClick={() => addRecipient(p)}
                    className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left hover:bg-black/5 dark:hover:bg-white/10"
                    data-testid={`persona-share-person-${p.pubkey.slice(0, 8)}`}
                  >
                    <span className="truncate text-xs text-black/70 dark:text-white/70">
                      {p.name}
                    </span>
                    <span className="ml-2 shrink-0 font-mono text-[9px] text-black/30 dark:text-white/30">
                      {p.pubkey.slice(0, 8)}…
                    </span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        <div>
          <label className={labelCls} htmlFor="persona-share-level">
            What’s included
          </label>
          <select
            id="persona-share-level"
            className={inputCls}
            value={effectiveLevel}
            disabled={!hasMemoryOptions || isActionPending}
            onChange={(e) => setShareLevel(e.target.value as SnapshotMemoryLevel)}
            data-testid="persona-share-level"
          >
            {SHARE_LEVELS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {!hasMemoryOptions && (
            <p className="mt-1 text-[10px] text-black/35 dark:text-white/35">
              Memory options appear when a linked agent has decryptable memories.
            </p>
          )}
        </div>

        {effectiveLevel !== "none" && (
          <div
            className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400"
            data-testid="persona-share-memory-warning"
          >
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <p>
              Memory is stored as <strong>plaintext</strong> in the snapshot. Only
              share it with people you trust.
            </p>
          </div>
        )}

        <div className="flex gap-2">
          <button
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-black px-3 py-2 text-sm font-medium text-white hover:opacity-80 disabled:opacity-40 dark:bg-white dark:text-black"
            disabled={isActionPending || recipients.length === 0}
            onClick={() => void handleSend()}
            data-testid="persona-share-send"
          >
            <Send className="h-4 w-4 shrink-0" />
            {sendPhase === "uploading"
              ? "Uploading…"
              : sendPhase === "sending"
                ? "Sending…"
                : "Send"}
          </button>
          <button
            className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-black/15 px-3 py-2 text-sm font-medium text-black/70 hover:bg-black/5 disabled:opacity-40 dark:border-white/15 dark:text-white/70 dark:hover:bg-white/10"
            disabled={isActionPending}
            onClick={() => void handleCopyLink()}
            data-copy-status={copyStatus}
            data-testid="persona-share-copy-link"
          >
            {copyStatus === "copied" ? (
              <Check className="h-4 w-4 shrink-0" />
            ) : (
              <Link2 className="h-4 w-4 shrink-0" />
            )}
            {copyLabel}
          </button>
        </div>

        <button
          className="flex w-full items-center gap-2 rounded-lg border border-black/15 px-3 py-2 text-sm font-medium text-black/70 hover:bg-black/5 disabled:opacity-40 dark:border-white/15 dark:text-white/70 dark:hover:bg-white/10"
          disabled={isActionPending}
          onClick={handleExport}
          data-testid="persona-share-export"
        >
          <Download className="h-4 w-4 shrink-0 text-black/40 dark:text-white/40" />
          Export agent (.agent.json)
        </button>

        <div className="flex items-start gap-3 rounded-lg border border-black/8 px-3 py-3 dark:border-white/8">
          <BookUser className="mt-0.5 h-4 w-4 shrink-0 text-black/40 dark:text-white/40" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-black dark:text-white">Share to catalog</p>
            <p className="text-[11px] text-black/45 dark:text-white/45">
              Anyone in this community can find and use a copy. Your agent
              instruction is shared as plaintext. Memories and secrets aren’t
              included.
            </p>
          </div>
          <input
            type="checkbox"
            className="mt-1"
            aria-label="Share to catalog"
            checked={persona.shared}
            disabled={isPublishing}
            onChange={(e) => onCatalogSharedChange(e.target.checked)}
            data-testid="persona-share-catalog-access"
          />
        </div>
      </div>
    </AgentDialogShell>
  );
}
