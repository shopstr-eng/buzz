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

  it("treats non-agent imeta files as generic file attachments", () => {
    const url = "https://media.example/blob/report.pdf";
    const { attachments } = extractAttachments(`[report.pdf](${url})`, [
      ["imeta", `url ${url}`, "m application/pdf", "filename report.pdf"],
    ]);
    expect(attachments[0].kind).toBe("file");
  });

  it("leaves prose links and inline media in the text", () => {
    const content =
      "See [the docs](https://example.com/docs) and ![image](https://media.example/pic.png)";
    const { text, attachments } = extractAttachments(content, [
      ["imeta", "url https://media.example/pic.png", "m image/png"],
    ]);
    expect(attachments).toHaveLength(0);
    expect(text).toBe(content);
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
