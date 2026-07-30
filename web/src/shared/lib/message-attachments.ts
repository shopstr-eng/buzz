/**
 * Receive-side parsing for NIP-92 imeta attachments and markdown file links —
 * the counterpart of `imeta-media.ts` (send side) and a web subset of
 * desktop's markdownFileCard resolution:
 *   - `imeta` tags on the event describe uploaded blobs (url/m/x/size/…).
 *   - The message content carries a markdown line per attachment:
 *     `[label](url)` for files, `![image|video](url)` for inline media.
 *
 * `extractAttachments` pulls the file-link lines out of the content so the
 * renderer can show clickable attachment cards instead of raw markdown, and
 * classifies `.agent.json` snapshot links so the card can offer an
 * "Add agent" import action (desktop AgentSnapshotCard parity).
 */

/** One parsed `imeta` tag (NIP-92 space-separated key/value fields). */
export interface ImetaEntry {
  url: string;
  mime?: string;
  sha256?: string;
  size?: number;
  thumb?: string;
  filename?: string;
}

export type AttachmentKind = "agent-snapshot" | "file";

export interface MessageAttachment {
  url: string;
  /** Display name: imeta filename, else markdown label, else URL basename. */
  name: string;
  kind: AttachmentKind;
  mime?: string;
  size?: number;
  sha256?: string;
  thumb?: string;
}

/** Parse the event's `imeta` tags into url-keyed entries. */
export function parseImetaTags(tags: ReadonlyArray<string[]>): Map<string, ImetaEntry> {
  const map = new Map<string, ImetaEntry>();
  for (const tag of tags) {
    if (tag[0] !== "imeta") continue;
    const fields = new Map<string, string>();
    for (const field of tag.slice(1)) {
      const space = field.indexOf(" ");
      if (space <= 0) continue;
      fields.set(field.slice(0, space), field.slice(space + 1));
    }
    const url = fields.get("url");
    if (!url) continue;
    const sizeRaw = fields.get("size");
    const size = sizeRaw ? Number.parseInt(sizeRaw, 10) : Number.NaN;
    map.set(url, {
      url,
      mime: fields.get("m"),
      sha256: fields.get("x"),
      size: Number.isFinite(size) && size > 0 ? size : undefined,
      thumb: fields.get("thumb"),
      filename: fields.get("filename"),
    });
  }
  return map;
}

/** Markdown link: optional image bang, escaped-bracket-aware label, http(s) url. */
const MD_LINK_RE = /(!?)\[((?:\\.|[^\]\\])*)\]\((https?:\/\/[^\s)]+)\)/g;

/** Snapshot filenames the send side produces (desktop + web share flows). */
const SNAPSHOT_EXT_RE = /\.(agent|team)\.(json|png)$/i;
const AGENT_JSON_RE = /\.agent\.json$/i;

function unescapeLabel(label: string): string {
  return label.replace(/\\([\\[\]])/g, "$1");
}

function urlBasename(url: string): string | undefined {
  try {
    const path = new URL(url).pathname;
    const base = path.split("/").pop();
    return base ? decodeURIComponent(base) : undefined;
  } catch {
    return undefined;
  }
}

function isInlineMedia(mime: string | undefined): boolean {
  return !!mime && (mime.startsWith("image/") || mime.startsWith("video/"));
}

export interface ExtractedContent {
  /** Content with attachment markdown lines removed. */
  text: string;
  attachments: MessageAttachment[];
}

/**
 * Split attachment file links out of message content.
 *
 * A markdown link becomes an attachment card when the event carries an
 * `imeta` entry for its URL (uploaded blob), or when the filename is a
 * recognizable snapshot (`.agent.json` / `.team.json` / `.agent.png` /
 * `.team.png`) even without imeta. Other links stay in the text (the
 * renderer linkifies them); inline `![…](url)` media lines are left alone.
 */
export function extractAttachments(
  content: string,
  tags?: ReadonlyArray<string[]>,
): ExtractedContent {
  const imeta = tags ? parseImetaTags(tags) : new Map<string, ImetaEntry>();
  if (!content.includes("](")) return { text: content, attachments: [] };

  const attachments: MessageAttachment[] = [];
  const text = content
    .replace(MD_LINK_RE, (match, bang: string, rawLabel: string, url: string) => {
      if (bang) return match; // inline image/video — leave for the text renderer
      const entry = imeta.get(url);
      const label = unescapeLabel(rawLabel).trim();
      const name = entry?.filename || label || urlBasename(url) || "file";
      const looksLikeSnapshot = SNAPSHOT_EXT_RE.test(name) || SNAPSHOT_EXT_RE.test(urlBasename(url) ?? "");
      // Uploaded inline media described by imeta stays as text (rendered inline
      // by whoever handles media); everything imeta-backed or snapshot-shaped
      // becomes a card.
      if (entry && isInlineMedia(entry.mime) && !looksLikeSnapshot) return match;
      if (!entry && !looksLikeSnapshot) return match; // ordinary prose link
      attachments.push({
        url,
        name,
        kind: AGENT_JSON_RE.test(name) ? "agent-snapshot" : "file",
        mime: entry?.mime,
        size: entry?.size,
        sha256: entry?.sha256,
        thumb: entry?.thumb,
      });
      return "";
    })
    // Collapse whitespace holes the removed lines left behind.
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { text, attachments };
}

/** "12.4 KB"-style size label (desktop FileCard parity). */
export function humanFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes;
  let unit = -1;
  do {
    value /= 1024;
    unit++;
  } while (value >= 1024 && unit < units.length - 1);
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}
