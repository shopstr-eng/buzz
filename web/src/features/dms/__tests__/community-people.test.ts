import { describe, it, expect } from "vitest";
import { parseProfileName } from "../use-community-people";

describe("parseProfileName", () => {
  it("prefers display_name over name (NIP-01 convention)", () => {
    expect(parseProfileName('{"name":"alice","display_name":"Alice A."}')).toBe("Alice A.");
    expect(parseProfileName('{"name":"alice"}')).toBe("alice");
  });

  it("trims and rejects empty names", () => {
    expect(parseProfileName('{"name":"  bob  "}')).toBe("bob");
    expect(parseProfileName('{"name":"   "}')).toBeNull();
    expect(parseProfileName('{}')).toBeNull();
  });

  it("rejects non-object / invalid content", () => {
    expect(parseProfileName("not json")).toBeNull();
    expect(parseProfileName('["alice"]')).toBeNull();
    expect(parseProfileName('{"name":42}')).toBeNull();
  });
});
