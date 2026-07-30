/**
 * Desktop-parity checks for the web imeta helpers: snapshot files must render
 * as labeled markdown file links (never inline images), and imeta tags must
 * carry the descriptor fields in desktop's field order.
 */

import { describe, expect, it } from "vitest";
import { buildImetaTags, formatImetaMediaLine } from "../imeta-media";
import type { BlobDescriptor } from "../blossom-upload";

const base: BlobDescriptor = {
  url: "https://relay.example/media/abc123",
  sha256: "abc123",
  size: 42,
  type: "application/json",
  filename: "helper.agent.json",
};

describe("formatImetaMediaLine", () => {
  it("renders non-media files as a labeled markdown link with leading newline", () => {
    expect(formatImetaMediaLine(base, { label: "Helper" })).toBe(
      "\n[Helper](https://relay.example/media/abc123)",
    );
  });

  it("falls back to filename when no label, escaping brackets", () => {
    expect(
      formatImetaMediaLine({ ...base, filename: "a[b].agent.json" }),
    ).toBe("\n[a\\[b\\].agent.json](https://relay.example/media/abc123)");
  });

  it("keeps snapshot PNGs as file links, not inline images", () => {
    const png = { ...base, type: "image/png", filename: "x.agent.png" };
    expect(formatImetaMediaLine(png)).toBe("\n[x.agent.png](https://relay.example/media/abc123)");
    expect(formatImetaMediaLine({ ...base, type: "image/png", filename: "pic.png" })).toBe(
      "\n![image](https://relay.example/media/abc123)",
    );
  });
});

describe("buildImetaTags", () => {
  it("emits NIP-92 imeta fields in desktop order, omitting absent ones", () => {
    expect(buildImetaTags([base])).toEqual([
      [
        "imeta",
        "url https://relay.example/media/abc123",
        "m application/json",
        "x abc123",
        "size 42",
        "filename helper.agent.json",
      ],
    ]);
  });
});
