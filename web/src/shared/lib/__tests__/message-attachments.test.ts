import { describe, expect, it } from "vitest";
import {
  extractAttachments,
  humanFileSize,
  parseImetaTags,
} from "../message-attachments";

const URL_JSON = "https://media.example/blob/helper.agent.json";
const IMETA_JSON = [
  "imeta",
  `url ${URL_JSON}`,
  "m application/json",
  "x " + "a".repeat(64),
  "size 1234",
  "filename Helper.agent.json",
];

describe("parseImetaTags", () => {
  it("parses url-keyed entries with typed fields", () => {
    const map = parseImetaTags([IMETA_JSON, ["p", "deadbeef"]]);
    const entry = map.get(URL_JSON);
    expect(entry).toBeDefined();
    expect(entry?.mime).toBe("application/json");
    expect(entry?.size).toBe(1234);
    expect(entry?.sha256).toBe("a".repeat(64));
    expect(entry?.filename).toBe("Helper.agent.json");
  });

  it("ignores tags without a url and bad sizes", () => {
    const map = parseImetaTags([
      ["imeta", "m application/json"],
      ["imeta", `url ${URL_JSON}`, "size nope"],
    ]);
    expect(map.size).toBe(1);
    expect(map.get(URL_JSON)?.size).toBeUndefined();
  });
});

describe("extractAttachments", () => {
  it("turns an imeta-backed markdown file link into an attachment", () => {
    const content = `Sharing my agent\n[Helper](${URL_JSON})`;
    const { text, attachments } = extractAttachments(content, [IMETA_JSON]);
    expect(text).toBe("Sharing my agent");
    expect(attachments).toHaveLength(1);
    expect(attachments[0]).toMatchObject({
      url: URL_JSON,
      name: "Helper.agent.json",
      kind: "agent-snapshot",
      size: 1234,
    });
  });

  it("classifies snapshot links even without imeta", () => {
    const { text, attachments } = extractAttachments(
      `[Helper.agent.json](${URL_JSON})`,
    );
    expect(text).toBe("");
    expect(attachments[0].kind).toBe("agent-snapshot");
  });

  it("classifies .team.json links as team-snapshot", () => {
    const url = "https://media.example/blob/ops.team.json";
    const { attachments } = extractAttachments(`[Ops.team.json](${url})`);
    expect(attachments).toHaveLength(1);
    expect(attachments[0].kind).toBe("team-snapshot");
  });

  it("classifies .team.png links as team-snapshot (PNG tEXt decoder)", () => {
    const url = "https://media.example/blob/ops.team.png";
    const { attachments } = extractAttachments(`[Ops.team.png](${url})`);
    expect(attachments).toHaveLength(1);
    expect(attachments[0].kind).toBe("team-snapshot");
  });

  it("classifies .agent.png links as agent-snapshot", () => {
    const url = "https://media.example/blob/helper.agent.png";
    const { attachments } = extractAttachments(`[Helper.agent.png](${url})`);
    expect(attachments).toHaveLength(1);
    expect(attachments[0].kind).toBe("agent-snapshot");
  });

  it("treats non-agent imeta files as generic file attachments", () => {
    const url = "https://media.example/blob/report.pdf";
    const { attachments } = extractAttachments(`[report.pdf](${url})`, [
      ["imeta", `url ${url}`, "m application/pdf", "filename report.pdf"],
    ]);
    expect(attachments[0].kind).toBe("file");
  });

  it("leaves prose links in the text but extracts inline media", () => {
    const content =
      "See [the docs](https://example.com/docs) and ![image](https://media.example/pic.png)";
    const { text, attachments, media } = extractAttachments(content, [
      ["imeta", "url https://media.example/pic.png", "m image/png"],
    ]);
    expect(attachments).toHaveLength(0);
    expect(media).toEqual([
      {
        url: "https://media.example/pic.png",
        type: "image",
        mime: "image/png",
        name: "pic.png",
      },
    ]);
    expect(text).toBe("See [the docs](https://example.com/docs) and");
  });

  it("classifies ![video] lines and imeta-backed video links as video", () => {
    const bang = extractAttachments("![video](https://media.example/clip.mp4)");
    expect(bang.media).toEqual([
      {
        url: "https://media.example/clip.mp4",
        type: "video",
        mime: undefined,
        name: "clip.mp4",
      },
    ]);
    expect(bang.text).toBe("");

    const linked = extractAttachments(
      "[clip](https://media.example/clip.bin)",
      [["imeta", "url https://media.example/clip.bin", "m video/mp4"]],
    );
    expect(linked.attachments).toHaveLength(0);
    expect(linked.media[0]).toMatchObject({ type: "video", mime: "video/mp4" });
  });

  it("unescapes bracket-escaped labels", () => {
    const { attachments } = extractAttachments(
      `[My \\[cool\\] agent](${URL_JSON})`,
      [IMETA_JSON.filter((f) => !f.startsWith("filename"))],
    );
    expect(attachments[0].name).toBe("My [cool] agent");
  });
});

describe("humanFileSize", () => {
  it("formats bytes, KB and MB", () => {
    expect(humanFileSize(512)).toBe("512 B");
    expect(humanFileSize(12_700)).toBe("12.4 KB");
    expect(humanFileSize(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});
