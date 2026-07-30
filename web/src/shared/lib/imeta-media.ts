/**
 * NIP-92 imeta helpers for attaching uploaded media to messages — a web
 * subset of desktop's imetaMediaMarkdown (formatImetaMediaLine +
 * buildImetaTags), byte-compatible for the snapshot-send flow: the content
 * carries a markdown line for the attachment, and the event carries an
 * `imeta` tag with the blob descriptor fields.
 */

import type { BlobDescriptor } from "./blossom-upload";

/**
 * Markdown line for one attachment, matching desktop's rules:
 * videos/images inline as `![…](url)`; everything else (including
 * `.agent.png` / `.team.png` snapshots) as a labeled file link.
 */
export function formatImetaMediaLine(
  { url, type, filename }: BlobDescriptor,
  options: { label?: string } = {},
): string {
  const lower = filename?.toLowerCase();
  const isSnapshotPng = lower?.endsWith(".agent.png") || lower?.endsWith(".team.png");
  if (type.startsWith("video/")) return `\n![video](${url})`;
  if (type.startsWith("image/") && !isSnapshotPng) return `\n![image](${url})`;
  const label = options.label?.trim() || filename || url.split("/").pop() || "file";
  const escaped = label.replace(/[\\[\]]/g, "\\$&");
  return `\n[${escaped}](${url})`;
}

/** One NIP-92 `imeta` tag per descriptor (desktop buildImetaTags parity). */
export function buildImetaTags(media: ReadonlyArray<BlobDescriptor>): string[][] {
  return media.map((d) => [
    "imeta",
    `url ${d.url}`,
    `m ${d.type}`,
    ...(d.sha256 ? [`x ${d.sha256}`] : []),
    ...(typeof d.size === "number" && d.size > 0 ? [`size ${d.size}`] : []),
    ...(d.dim ? [`dim ${d.dim}`] : []),
    ...(d.blurhash ? [`blurhash ${d.blurhash}`] : []),
    ...(d.thumb ? [`thumb ${d.thumb}`] : []),
    ...(d.duration != null ? [`duration ${d.duration}`] : []),
    ...(d.image ? [`image ${d.image}`] : []),
    ...(d.filename ? [`filename ${d.filename}`] : []),
  ]);
}
