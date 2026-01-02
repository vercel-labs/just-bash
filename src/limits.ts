/**
 * Execution Limits Configuration
 *
 * Centralized configuration for all execution limits to prevent runaway compute.
 * These limits can be overridden when creating a BashEnv instance.
 */

/**
 * Configuration for execution limits.
 * All limits are optional - undefined values use defaults.
 */
export interface ExecutionLimits {
  /** Maximum function call/recursion depth (default: 100) */
  maxCallDepth?: number;

  /** Maximum number of commands to execute (default: 10000) */
  maxCommandCount?: number;

  /** Maximum loop iterations for bash while/for/until loops (default: 10000) */
  maxLoopIterations?: number;

  /** Maximum loop iterations for AWK while/for loops (default: 10000) */
  maxAwkIterations?: number;

  /** Maximum command iterations for SED (branch loops) (default: 10000) */
  maxSedIterations?: number;

  /** Maximum iterations for jq loops (until, while, repeat) (default: 10000) */
  maxJqIterations?: number;
}

/**
 * Default execution limits.
 * These are conservative limits designed to prevent runaway execution
 * while allowing reasonable scripts to complete.
 */
const DEFAULT_LIMITS: Required<ExecutionLimits> = {
  maxCallDepth: 100,
  maxCommandCount: 10000,
  maxLoopIterations: 10000,
  maxAwkIterations: 10000,
  maxSedIterations: 10000,
  maxJqIterations: 10000,
};

/**
 * Resolve execution limits by merging user-provided limits with defaults.
 */
export function resolveLimits(
  userLimits?: ExecutionLimits,
): Required<ExecutionLimits> {
  if (!userLimits) {
    return { ...DEFAULT_LIMITS };
  }
  return {
    maxCallDepth: userLimits.maxCallDepth ?? DEFAULT_LIMITS.maxCallDepth,
    maxCommandCount:
      userLimits.maxCommandCount ?? DEFAULT_LIMITS.maxCommandCount,
    maxLoopIterations:
      userLimits.maxLoopIterations ?? DEFAULT_LIMITS.maxLoopIterations,
    maxAwkIterations:
      userLimits.maxAwkIterations ?? DEFAULT_LIMITS.maxAwkIterations,
    maxSedIterations:
      userLimits.maxSedIterations ?? DEFAULT_LIMITS.maxSedIterations,
    maxJqIterations:
      userLimits.maxJqIterations ?? DEFAULT_LIMITS.maxJqIterations,
  };
}
