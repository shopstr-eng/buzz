import { describe, it, expect } from "vitest";
import { mergePins, parsePinsJson } from "../lib/pins-sync";

describe("parsePinsJson", () => {
  it("accepts the desktop shape", () => {
    const pins = parsePinsJson(
      JSON.stringify({ version: 1, channels: { "chan-1": { starred: true, updatedAt: 123 } } }),
    );
    expect(pins).toEqual({ "chan-1": { starred: true, updatedAt: 123 } });
  });

  it("rejects wrong version / missing channels / invalid JSON", () => {
    expect(parsePinsJson('{"version":2,"channels":{}}')).toBeNull();
    expect(parsePinsJson('{"version":1}')).toBeNull();
    expect(parsePinsJson("nope")).toBeNull();
  });

  it("skips malformed entries but keeps valid ones", () => {
    const pins = parsePinsJson(
      JSON.stringify({
        version: 1,
        channels: { good: { starred: false, updatedAt: 5 }, bad: { starred: "yes" } },
      }),
    );
    expect(pins).toEqual({ good: { starred: false, updatedAt: 5 } });
  });
});

describe("mergePins", () => {
  it("remote wins when newer, local when older", () => {
    const local = { a: { starred: true, updatedAt: 100 }, b: { starred: false, updatedAt: 50 } };
    const remote = { a: { starred: false, updatedAt: 90 }, b: { starred: true, updatedAt: 60 } };
    expect(mergePins(local, remote)).toEqual({
      a: { starred: true, updatedAt: 100 },
      b: { starred: true, updatedAt: 60 },
    });
  });

  it("ties keep the local entry (desktop >= rule)", () => {
    const local = { a: { starred: true, updatedAt: 100 } };
    const remote = { a: { starred: false, updatedAt: 100 } };
    expect(mergePins(local, remote).a.starred).toBe(true);
  });
});
