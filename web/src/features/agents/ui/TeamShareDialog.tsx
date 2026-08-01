/**
 * Share dialog for a team — publishes/retracts the kind:30178 team-catalog
 * projection (NIP-AP). Mirrors the persona share dialog's catalog toggle,
 * with the NIP-AP-mandated warning: sharing a team exposes EVERY member's
 * full instructions, including members whose own personas are private.
 *
 * DM-send and copy-link (persona-share parity): the snapshot is uploaded to
 * the relay's Blossom media endpoint as .team.json or .team.png and either
 * sent as a file attachment in a DM (kind 9 + NIP-92 imeta) or copied as a
 * blob URL. `.team.png` sends render with AttachmentCard's "Add team" import
 * affordance in chat.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  BookUser,
  Bot,
  Check,
  Download,
  Link2,
  RefreshCw,
  Send,
  X,
} from "lucide-react";
import { useRelay } from "@/shared/context/relay-context";
import { getSignFn } from "@/shared/lib/identity";
import { uploadMediaBytes, type BlobDescriptor } from "@/shared/lib/blossom-upload";
import { buildImetaTags, formatImetaMediaLine } from "@/shared/lib/imeta-media";
import { useChannels } from "../../channels/use-channels";
import { KIND_STREAM_MSG, type Channel } from "../../channels/types";
import { findDmChannel, useOpenDm } from "../../dms/use-open-dm";
import { useCommunityPeople, type CommunityPerson } from "../../dms/use-community-people";
import type { AgentPersona, AgentTeam } from "../use-agents";
import { buildTeamSnapshot } from "../lib/team-snapshot";
import { TEAM_PNG_CHUNK_KEYWORD, encodePngWithSnapshotJson } from "../lib/png-text-chunk";
import { dataUrlToBytes, downloadBytes } from "../lib/snapshot-download";
import { AgentDialogShell, DialogError, labelCls, inputCls } from "./agent-dialog-shell";

/** How long to wait for the relay to create a fresh DM channel. */
const DM_RESOLVE_TIMEOUT_MS = 10_000;
const DM_RESOLVE_POLL_MS = 250;
const COPY_FEEDBACK_RESET_MS = 1500;
const MAX_RECIPIENTS = 8;

type SendPhase = "idle" | "uploading" | "sending" | "done";
type CopyStatus = "idle" | "copying" | "copied";
/** File format for the DM-send / copy-link snapshot upload. */
type SnapshotFormat = "json" | "png";

const SHARE_FORMATS: { value: SnapshotFormat; label: string; hint: string }[] = [
  { value: "png", label: "Image (.team.png)", hint: "Shows an image preview in chat" },
  { value: "json", label: "File (.team.json)", hint: "Plain JSON snapshot file" },
];

export function TeamShareDialog({
  team,
  members,
  missingMemberCount,
  shared,
  isStale,
  isPublishing,
  publishError,
  onSharedChange,
  onClose,
}: {
  team: AgentTeam;
  /** Resolved member personas (team.personaIds that still exist locally). */
  members: AgentPersona[];
  /** personaIds that no longer resolve to a persona (deleted) — excluded from the share. */
  missingMemberCount: number;
  shared: boolean;
  /** Shared, but the published snapshot no longer matches the current team/member fields. */
  isStale: boolean;
  isPublishing: boolean;
  publishError: string | null;
  /** Publishes the 30178 projection with/without the ["shared","true"] tag. */
  onSharedChange: (shared: boolean) => void;
  onClose: () => void;
}) {
  const { connection, identity } = useRelay();
  const { channels } = useChannels();
  const { openDm } = useOpenDm();
  const people = useCommunityPeople();

  const [shareFormat, setShareFormat] = useState<SnapshotFormat>("png");
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

  const isSending = sendPhase === "uploading" || sendPhase === "sending";
  const isActionPending = isPublishing || isSending || copyStatus === "copying";
  const hasMembers = members.length > 0;

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

  /** Encode the team snapshot as .team.json bytes. */
  function encodeSnapshot(): { bytes: Uint8Array; fileName: string } {
    const snapshot = buildTeamSnapshot(team, members);
    return {
      bytes: new TextEncoder().encode(JSON.stringify(snapshot, null, 2)),
      fileName: `${team.id}.team.json`,
    };
  }

  /**
   * Encode the snapshot as a .team.png — the manifest embedded in a
   * buzz_team_snapshot tEXt chunk, using the first member's PNG avatar as
   * the image body when available (same body as the PNG export).
   */
  function encodeSnapshotPng(): { bytes: Uint8Array; fileName: string } {
    const { bytes } = encodeSnapshot();
    const avatarUrl = members.find((m) => m.avatarUrl)?.avatarUrl ?? null;
    const avatarBytes = avatarUrl ? dataUrlToBytes(avatarUrl) : null;
    const png = encodePngWithSnapshotJson(
      new TextDecoder().decode(bytes),
      TEAM_PNG_CHUNK_KEYWORD,
      avatarBytes,
    );
    return { bytes: png, fileName: `${team.id}.team.png` };
  }

  /**
   * Upload the snapshot in the chosen share format. PNG uploads point the
   * imeta `thumb` at the blob itself so the attachment card shows an image
   * preview in chat.
   */
  async function uploadSnapshot(format: SnapshotFormat): Promise<BlobDescriptor> {
    if (format === "png") {
      const { bytes, fileName } = encodeSnapshotPng();
      const uploaded = await uploadMediaBytes(bytes, fileName, "image/png");
      return { ...uploaded, thumb: uploaded.url };
    }
    const { bytes, fileName } = encodeSnapshot();
    return uploadMediaBytes(bytes, fileName, "application/json");
  }

  /** Download a .team.json or .team.png snapshot of the team + members. */
  function handleExport(format: SnapshotFormat): void {
    if (format === "json") {
      const { bytes, fileName } = encodeSnapshot();
      downloadBytes(bytes, fileName, "application/json");
      return;
    }
    const png = encodeSnapshotPng();
    downloadBytes(png.bytes, png.fileName, "image/png");
  }

  /** Upload the snapshot and copy its blob URL to the clipboard. */
  async function handleCopyLink(): Promise<void> {
    if (inFlightRef.current || isActionPending) return;

    inFlightRef.current = true;
    setActionError(null);
    setCopyStatus("copying");
    try {
      const uploaded = await uploadSnapshot(shareFormat);
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

    const signFn = getSignFn();
    if (!signFn) {
      setActionError("No signing key available. Please log in again.");
      return;
    }

    inFlightRef.current = true;
    setActionError(null);
    setSendPhase("uploading");
    try {
      const uploaded = await uploadSnapshot(shareFormat);
      const channel = await resolveDmChannel(recipients.map((r) => r.pubkey));

      setSendPhase("sending");
      const content = formatImetaMediaLine(uploaded, { label: team.name });
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
        err instanceof Error ? `Couldn’t send team: ${err.message}` : "Couldn’t send team.",
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
    <AgentDialogShell title={`Share ${team.name}`} onClose={onClose}>
      <div className="space-y-4 p-5">
        <DialogError message={publishError} />
        <DialogError message={actionError} />
        <p className="text-xs text-black/50 dark:text-white/50">
          Sharing publishes a snapshot of this team to the community catalog.
          Anyone in this community can find it and import a copy. Changes you
          make later won’t sync until you re-share.
        </p>

        {shared && isStale && (
          <div
            className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400"
            data-testid="team-share-stale-warning"
          >
            <RefreshCw className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <p>
                The shared snapshot is <strong>out of date</strong> — the team or
                its members changed since it was published. The catalog still
                shows the old version.
              </p>
              <button
                className="mt-1.5 rounded-lg bg-amber-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-amber-700 disabled:opacity-50"
                disabled={isPublishing}
                onClick={() => onSharedChange(true)}
                data-testid="team-share-stale-reshare"
              >
                Re-share current version
              </button>
            </div>
          </div>
        )}

        <div
          className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400"
          data-testid="team-share-members-warning"
        >
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <p>
            Sharing a team exposes the <strong>full instructions of every
            member</strong> as plaintext — including members whose personas are
            private and not individually shared. Allowlists, memories, and
            secrets are never included.
          </p>
        </div>

        <div>
          <p className="mb-1.5 text-xs font-semibold text-black/60 dark:text-white/60">
            Members included ({members.length})
          </p>
          {members.length === 0 ? (
            <p className="rounded-lg border border-dashed border-black/15 px-3 py-3 text-center text-[11px] text-black/40 dark:border-white/15 dark:text-white/40">
              This team has no members — the shared snapshot will be empty.
            </p>
          ) : (
            <ul className="space-y-1">
              {members.map((m) => (
                <li
                  key={m.id}
                  className="flex items-center gap-2 rounded-lg border border-black/8 px-3 py-1.5 dark:border-white/8"
                  data-testid={`team-share-member-${m.id}`}
                >
                  <Bot className="h-3.5 w-3.5 shrink-0 text-violet-500" />
                  <span className="min-w-0 flex-1 truncate text-xs text-black/70 dark:text-white/70">
                    {m.displayName}
                  </span>
                  {!m.shared && (
                    <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
                      private persona
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {missingMemberCount > 0 && (
            <p className="mt-1 text-[10px] text-black/35 dark:text-white/35">
              {missingMemberCount} member{missingMemberCount === 1 ? "" : "s"} no
              longer exist{missingMemberCount === 1 ? "s" : ""} and will be left
              out of the share.
            </p>
          )}
        </div>

        <div data-testid="team-share-recipients">
          <label className={labelCls} htmlFor="team-share-recipient-search">
            Send to
          </label>
          {recipients.length > 0 && (
            <div className="mb-1.5 flex flex-wrap gap-1">
              {recipients.map((r) => (
                <span
                  key={r.pubkey}
                  className="flex items-center gap-1 rounded-full bg-black/8 px-2 py-0.5 text-xs text-black/70 dark:bg-white/12 dark:text-white/70"
                  data-testid={`team-share-recipient-${r.pubkey.slice(0, 8)}`}
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
            id="team-share-recipient-search"
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
            data-testid="team-share-recipient-search"
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
                    data-testid={`team-share-person-${p.pubkey.slice(0, 8)}`}
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
          <label className={labelCls} htmlFor="team-share-format">
            Send as
          </label>
          <select
            id="team-share-format"
            className={inputCls}
            value={shareFormat}
            disabled={isActionPending}
            onChange={(e) => setShareFormat(e.target.value as SnapshotFormat)}
            data-testid="team-share-format"
          >
            {SHARE_FORMATS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-[10px] text-black/35 dark:text-white/35">
            {SHARE_FORMATS.find((o) => o.value === shareFormat)?.hint}
          </p>
        </div>

        <div className="flex gap-2">
          <button
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-black px-3 py-2 text-sm font-medium text-white hover:opacity-80 disabled:opacity-40 dark:bg-white dark:text-black"
            disabled={isActionPending || recipients.length === 0 || !hasMembers}
            onClick={() => void handleSend()}
            data-testid="team-share-send"
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
            disabled={isActionPending || !hasMembers}
            onClick={() => void handleCopyLink()}
            data-copy-status={copyStatus}
            data-testid="team-share-copy-link"
          >
            {copyStatus === "copied" ? (
              <Check className="h-4 w-4 shrink-0" />
            ) : (
              <Link2 className="h-4 w-4 shrink-0" />
            )}
            {copyLabel}
          </button>
        </div>

        <div className="flex gap-2">
          <button
            className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-black/15 px-3 py-2 text-sm font-medium text-black/70 hover:bg-black/5 disabled:opacity-40 dark:border-white/15 dark:text-white/70 dark:hover:bg-white/10"
            disabled={!hasMembers}
            onClick={() => handleExport("json")}
            data-testid="team-share-export"
          >
            <Download className="h-4 w-4 shrink-0 text-black/40 dark:text-white/40" />
            Export (.team.json)
          </button>
          <button
            className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-black/15 px-3 py-2 text-sm font-medium text-black/70 hover:bg-black/5 disabled:opacity-40 dark:border-white/15 dark:text-white/70 dark:hover:bg-white/10"
            disabled={!hasMembers}
            onClick={() => handleExport("png")}
            data-testid="team-share-export-png"
          >
            <Download className="h-4 w-4 shrink-0 text-black/40 dark:text-white/40" />
            Export (.team.png)
          </button>
        </div>

        <div className="flex items-start gap-3 rounded-lg border border-black/8 px-3 py-3 dark:border-white/8">
          <BookUser className="mt-0.5 h-4 w-4 shrink-0 text-black/40 dark:text-white/40" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-black dark:text-white">Share to catalog</p>
            <p className="text-[11px] text-black/45 dark:text-white/45">
              Turning this off retracts the team from the catalog (the snapshot
              stays visible only to you).
            </p>
          </div>
          <input
            type="checkbox"
            className="mt-1"
            aria-label="Share team to catalog"
            checked={shared}
            disabled={isPublishing}
            onChange={(e) => onSharedChange(e.target.checked)}
            data-testid="team-share-catalog-access"
          />
        </div>
      </div>
    </AgentDialogShell>
  );
}
