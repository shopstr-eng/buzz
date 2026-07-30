/**
 * Regression tests for the kind:44200 turn-metric aggregation rules
 * (NIP-AM / upstream #3593 parity):
 *
 * - totalTokens sums PER-TURN provider totals only, preferring `totalTokens`
 *   over the aliases `turnTotalTokens`, `total_tokens`, `turn_total_tokens`
 *   — without double-counting when several aliases are present.
 * - Session-cumulative fields (accumulatedTotalTokens & friends) are ignored;
 *   summing them across turns would overcount.
 * - When no per-turn total is present, totalTokens contribution is 0
 *   (callers fall back to input+output; the aggregate never derives it).
 */

import { describe, it, expect } from "vitest";
import {
  foldTurnMetric,
  type AgentMetricAggregate,
  type TurnMetricPayload,
  type TokenCounts,
} from "../use-agent-metrics";

const AGENT = "ab".repeat(32);

function fold(
  countsList: (TokenCounts & Record<string, unknown>)[],
  base?: Partial<TurnMetricPayload>,
): AgentMetricAggregate {
  let agg: AgentMetricAggregate | undefined;
  let t = 1000;
  for (const counts of countsList) {
    const payload: TurnMetricPayload = {
      model: "gpt-x",
      harness: "codex",
      ...base,
      turn: counts as TokenCounts,
    };
    agg = foldTurnMetric(agg, payload, AGENT, t++);
  }
  return agg!;
}

describe("foldTurnMetric totalTokens precedence", () => {
  it("prefers camelCase totalTokens over all aliases without double-counting", () => {
    const agg = fold([
      {
        totalTokens: 100,
        turnTotalTokens: 999,
        total_tokens: 888,
        turn_total_tokens: 777,
      },
    ]);
    expect(agg.totalTokens).toBe(100);
  });

  it("falls back through turnTotalTokens → total_tokens → turn_total_tokens", () => {
    expect(fold([{ turnTotalTokens: 50, total_tokens: 999 }]).totalTokens).toBe(50);
    expect(fold([{ total_tokens: 40, turn_total_tokens: 999 }]).totalTokens).toBe(40);
    expect(fold([{ turn_total_tokens: 30 }]).totalTokens).toBe(30);
  });

  it("sums per-turn totals across turns exactly once each", () => {
    const agg = fold([
      { totalTokens: 10, turnTotalTokens: 999 },
      { turnTotalTokens: 20 },
      { total_tokens: 30 },
    ]);
    expect(agg.turns).toBe(3);
    expect(agg.totalTokens).toBe(60);
  });

  it("ignores session-cumulative accumulated totals (would overcount)", () => {
    // A publisher that only reports session-cumulative counts must contribute
    // 0 to totalTokens — summing cumulative values across turns overcounts.
    const agg = fold([
      { accumulatedTotalTokens: 500, accumulated_total_tokens: 500 },
      { accumulatedTotalTokens: 1100, accumulated_total_tokens: 1100 },
    ]);
    expect(agg.totalTokens).toBe(0);
  });

  it("is 0 when no turn carried a provider total (e.g. goose)", () => {
    const agg = fold([
      { inputTokens: 100, outputTokens: 50 },
      { inputTokens: 10, outputTokens: 5 },
    ]);
    expect(agg.totalTokens).toBe(0);
    expect(agg.inputTokens).toBe(110);
    expect(agg.outputTokens).toBe(55);
  });

  it("mixes turns with and without provider totals correctly", () => {
    const agg = fold([
      { totalTokens: 100, inputTokens: 60, outputTokens: 30 },
      { inputTokens: 10, outputTokens: 5 }, // no provider total this turn
      { totalTokens: 7 },
    ]);
    expect(agg.totalTokens).toBe(107);
    expect(agg.inputTokens).toBe(70);
    expect(agg.outputTokens).toBe(35);
  });

  it("treats null as absent (falls through) but non-finite values as 0", () => {
    expect(
      fold([{ totalTokens: null, turnTotalTokens: 25 }]).totalTokens,
    ).toBe(25);
    // `??` only falls through on null/undefined — a NaN total wins precedence
    // and is then sanitised to 0 rather than deferring to a lower alias.
    expect(
      fold([{ totalTokens: Number.NaN as number, turn_total_tokens: 5 }]).totalTokens,
    ).toBe(0);
  });
});

describe("foldTurnMetric counts-container and snake_case fallbacks", () => {
  it("reads counts from turn ?? usage ?? turn_counts", () => {
    let agg = foldTurnMetric(
      undefined,
      { model: "m", usage: { totalTokens: 11 } },
      AGENT,
      1,
    );
    agg = foldTurnMetric(
      agg,
      { model: "m", turn_counts: { totalTokens: 22 } },
      AGENT,
      2,
    );
    expect(agg.totalTokens).toBe(33);
    expect(agg.turns).toBe(2);
  });

  it("prefers camelCase input/output/cost over snake_case aliases", () => {
    const agg = fold([
      {
        inputTokens: 10,
        input_tokens: 999,
        outputTokens: 20,
        output_tokens: 999,
        costUsd: 0.5,
        cost_usd: 999,
      },
    ]);
    expect(agg.inputTokens).toBe(10);
    expect(agg.outputTokens).toBe(20);
    expect(agg.costUsd).toBe(0.5);
  });
});
