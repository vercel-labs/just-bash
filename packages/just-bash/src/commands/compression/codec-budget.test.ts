import { describe, expect, it } from "vitest";
import { CodecBudget } from "./codec-budget.js";

describe("CodecBudget", () => {
  it("rejects an output chunk prospectively", () => {
    const budget = new CodecBudget({
      maxInputBytes: 10,
      maxOutputBytes: 4,
      label: "test codec",
    });
    budget.acceptInput(2);
    budget.acceptOutput(4);
    expect(() => budget.acceptOutput(1)).toThrow(
      "test codec: output exceeds limit (4 bytes)",
    );
    expect(budget.outputLength).toBe(4);
  });

  it("checks cancellation at codec boundaries", () => {
    const controller = new AbortController();
    const budget = new CodecBudget({
      maxInputBytes: 10,
      maxOutputBytes: 10,
      signal: controller.signal,
    });
    controller.abort();
    expect(() => budget.acceptInput(1)).toThrow("codec: operation aborted");
  });

  it("guards expansion ratio after a grace allowance", () => {
    const budget = new CodecBudget({
      maxInputBytes: 100,
      maxOutputBytes: 100,
      maxExpansionRatio: 2,
      ratioGraceBytes: 0,
    });
    budget.acceptInput(2);
    expect(() => budget.acceptOutput(5)).toThrow("expansion ratio");
  });
});
