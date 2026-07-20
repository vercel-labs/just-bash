import { describe, expect, it } from "vitest";
import { getDevExecutionLimits } from "./exec-limits.js";

describe("developer CLI execution limits", () => {
  it("removes shell and traversal accounting ceilings with --no-limit", () => {
    expect(getDevExecutionLimits(true)).toMatchObject({
      maxCommandCount: Number.POSITIVE_INFINITY,
      maxLoopIterations: Number.POSITIVE_INFINITY,
      maxTraversalEntries: Number.POSITIVE_INFINITY,
      maxTraversalWork: Number.POSITIVE_INFINITY,
    });
  });
});
