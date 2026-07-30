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

export type AttachmentKind = "agent-snapshot" | "team-snapshot" | "file";

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
// .png snapshots carry their manifest in a PNG tEXt chunk that the card's
// import path decodes browser-side (png-text-chunk.ts, desktop parity).
const AGENT_SNAPSHOT_RE = /\.agent\.(json|png)$/i;
const TEAM_SNAPSHOT_RE = /\.team\.(json|png)$/i;

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

/** Inline media (`![image|video](url)`) pulled out of the content. */
export interface InlineMedia {
  url: string;
  type: "image" | "video";
  mime?: string;
  /** Markdown label / imeta filename, for alt text. */
  name?: string;
}

const VIDEO_EXT_RE = /\.(mp4|webm|mov|m4v|ogv)$/i;

/** Classify an inline `![label](url)` as image or video. */
function inlineMediaType(
  label: string,
  url: string,
  mime: string | undefined,
): "image" | "video" {
  if (mime?.startsWith("video/")) return "video";
  if (mime?.startsWith("image/")) return "image";
  if (/^video$/i.test(label)) return "video";
  if (VIDEO_EXT_RE.test(urlBasename(url) ?? "")) return "video";
  return "image";
}

export interface ExtractedContent {
  /** Content with attachment markdown lines removed. */
  text: string;
  attachments: MessageAttachment[];
  /** Inline `![image|video](url)` media, in content order. */
  media: InlineMedia[];
}

/**
 * Split attachment file links out of message content.
 *
 * A markdown link becomes an attachment card when the event carries an
 * `imeta` entry for its URL (uploaded blob), or when the filename is a
 * recognizable snapshot (`.agent.json` / `.team.json` / `.agent.png` /
 * `.team.png`) even without imeta. Other links stay in the text (the
 * renderer linkifies them); inline `![…](url)` media lines (and imeta-backed
 * image/video links) come back in `media` for inline rendering.
 */
export function extractAttachments(
  content: string,
  tags?: ReadonlyArray<string[]>,
): ExtractedContent {
  const imeta = tags ? parseImetaTags(tags) : new Map<string, ImetaEntry>();
  if (!content.includes("](")) return { text: content, attachments: [], media: [] };

  const attachments: MessageAttachment[] = [];
  const media: InlineMedia[] = [];
  const text = content
    .replace(MD_LINK_RE, (match, bang: string, rawLabel: string, url: string) => {
      const entry = imeta.get(url);
      const label = unescapeLabel(rawLabel).trim();
      const name = entry?.filename || label || urlBasename(url) || "file";
      const looksLikeSnapshot = SNAPSHOT_EXT_RE.test(name) || SNAPSHOT_EXT_RE.test(urlBasename(url) ?? "");
      if (bang) {
        // Inline `![image|video](url)` media — render inline instead of raw text.
        media.push({
          url,
          type: inlineMediaType(label, url, entry?.mime),
          mime: entry?.mime,
          name: entry?.filename || urlBasename(url) || undefined,
        });
        return "";
      }
      // Non-bang links: uploaded inline media described by imeta also renders
      // inline (desktop parity); everything imeta-backed or snapshot-shaped
      // becomes a card.
      if (entry && isInlineMedia(entry.mime) && !looksLikeSnapshot) {
        media.push({
          url,
          type: inlineMediaType(label, url, entry.mime),
          mime: entry.mime,
          name: entry.filename || urlBasename(url) || undefined,
        });
        return "";
      }
      if (!entry && !looksLikeSnapshot) return match; // ordinary prose link
      attachments.push({
        url,
        name,
        kind: AGENT_SNAPSHOT_RE.test(name)
          ? "agent-snapshot"
          : TEAM_SNAPSHOT_RE.test(name)
            ? "team-snapshot"
            : "file",
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

  return { text, attachments, media };
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
