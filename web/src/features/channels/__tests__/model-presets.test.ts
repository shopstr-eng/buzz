import { describe, expect, it } from "vitest";
import { AI_MODELS, findModelPreset } from "../types";

describe("findModelPreset", () => {
  it("resolves every current preset by id", () => {
    for (const preset of AI_MODELS) {
      expect(findModelPreset(preset.id)?.id).toBe(preset.id);
    }
  });

  it("resolves current preset names", () => {
    expect(findModelPreset("Claude Opus 4.5")?.id).toBe("anthropic/claude-opus-4.5");
    expect(findModelPreset("Kimi K3")?.id).toBe("moonshotai/kimi-k3");
  });

  it("resolves legacy pre-OpenRouter ids and names", () => {
    expect(findModelPreset("claude")?.id).toBe("anthropic/claude-opus-4.5");
    expect(findModelPreset("Claude")?.id).toBe("anthropic/claude-opus-4.5");
    expect(findModelPreset("codex-acp")?.id).toBe("openai/gpt-5.2");
    expect(findModelPreset("Codex")?.id).toBe("openai/gpt-5.2");
  });

  it("returns undefined for unknown values", () => {
    expect(findModelPreset("no-such-model")).toBeUndefined();
    expect(findModelPreset("")).toBeUndefined();
  });
});
