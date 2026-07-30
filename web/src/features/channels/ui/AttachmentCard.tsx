/**
 * Clickable attachment card for messages carrying NIP-92 imeta uploads or
 * snapshot file links — web parity for desktop's FileCard/AgentSnapshotCard.
 * `.agent.json` snapshot links additionally offer a one-click "Add agent"
 * import when the parent wires `onImportAgent`.
 */

import { useState } from "react";
import { Bot, Check, Download, FileText, Loader2 } from "lucide-react";
import { humanFileSize, type MessageAttachment } from "@/shared/lib/message-attachments";
import { MAX_SNAPSHOT_JSON_BYTES } from "@/features/agents/lib/agent-snapshot";

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Verified snapshot download (desktop fetchSnapshotBytes parity, browser
 * flavor): bounded size, and SHA-256 checked when the imeta carried one.
 */
async function fetchSnapshotText(att: MessageAttachment): Promise<string> {
  const res = await fetch(att.url);
  if (!res.ok) throw new Error(`Download failed (HTTP ${res.status}).`);
  const buf = await res.arrayBuffer();
  const limit = att.size ?? MAX_SNAPSHOT_JSON_BYTES;
  if (buf.byteLength > Math.min(limit, MAX_SNAPSHOT_JSON_BYTES)) {
    throw new Error("Snapshot is larger than expected.");
  }
  if (att.sha256 && (await sha256Hex(buf)) !== att.sha256.toLowerCase()) {
    throw new Error("Snapshot failed its checksum — refusing to import.");
  }
  return new TextDecoder().decode(buf);
}

type ImportState = "idle" | "importing" | "done";

export function AttachmentCard({
  attachment,
  onImportAgent,
}: {
  attachment: MessageAttachment;
  /** Import a fetched .agent.json snapshot; throws with a user-facing message. */
  onImportAgent?: (jsonText: string) => Promise<void>;
}) {
  const [importState, setImportState] = useState<ImportState>("idle");
  const [importError, setImportError] = useState<string | null>(null);
  const isAgentSnapshot = attachment.kind === "agent-snapshot";
  const Icon = isAgentSnapshot ? Bot : FileText;

  async function handleImport() {
    if (!onImportAgent || importState !== "idle") return;
    setImportState("importing");
    setImportError(null);
    try {
      await onImportAgent(await fetchSnapshotText(attachment));
      setImportState("done");
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "Import failed.");
      setImportState("idle");
    }
  }

  return (
    <div className="mt-1.5 inline-flex max-w-full flex-col gap-1 rounded-lg border border-black/10 bg-black/[0.03] px-3 py-2 dark:border-white/10 dark:bg-white/[0.04]">
      <div className="flex items-center gap-2.5">
        {attachment.thumb ? (
          <img
            src={attachment.thumb}
            alt=""
            className="h-8 w-8 shrink-0 rounded object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-violet-100 dark:bg-violet-900/40">
            <Icon className="h-4 w-4 text-violet-600 dark:text-violet-300" />
          </div>
        )}
        <div className="min-w-0">
          <a
            href={attachment.url}
            target="_blank"
            rel="noopener noreferrer"
            download={attachment.name}
            className="block max-w-[280px] truncate text-xs font-medium text-black/80 hover:underline dark:text-white/80"
            title={attachment.name}
          >
            {attachment.name}
          </a>
          <span className="text-[10px] text-black/40 dark:text-white/40">
            {isAgentSnapshot ? "Agent snapshot" : "File"}
            {attachment.size ? ` · ${humanFileSize(attachment.size)}` : ""}
          </span>
        </div>
        <a
          href={attachment.url}
          target="_blank"
          rel="noopener noreferrer"
          download={attachment.name}
          className="ml-1 rounded p-1.5 text-black/40 hover:bg-black/5 hover:text-black/70 dark:text-white/40 dark:hover:bg-white/10 dark:hover:text-white/70"
          title="Download"
        >
          <Download className="h-3.5 w-3.5" />
        </a>
        {isAgentSnapshot && onImportAgent && (
          <button
            type="button"
            onClick={() => void handleImport()}
            disabled={importState !== "idle"}
            className="flex items-center gap-1 rounded-lg bg-violet-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-violet-700 disabled:opacity-60"
          >
            {importState === "importing" && <Loader2 className="h-3 w-3 animate-spin" />}
            {importState === "done" && <Check className="h-3 w-3" />}
            {importState === "done" ? "Added" : importState === "importing" ? "Adding…" : "Add agent"}
          </button>
        )}
      </div>
      {importError && (
        <p className="text-[10px] text-red-600 dark:text-red-400">{importError}</p>
      )}
    </div>
  );
}
