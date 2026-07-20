import type { ExecutionLimits } from "../limits.js";

/** Resource policy for the developer execution CLI. */
export function getDevExecutionLimits(noLimit: boolean): ExecutionLimits {
  if (noLimit) {
    return {
      maxCommandCount: Number.POSITIVE_INFINITY,
      maxLoopIterations: Number.POSITIVE_INFINITY,
      maxTraversalEntries: Number.POSITIVE_INFINITY,
      maxTraversalWork: Number.POSITIVE_INFINITY,
    };
  }

  return {
    maxCommandCount: 100_000,
    maxLoopIterations: 100_000,
  };
}
