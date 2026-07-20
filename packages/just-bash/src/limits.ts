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
  /** Maximum shell source bytes accepted before parsing (normal default: 64 MiB) */
  maxSourceBytes?: number;

  /** Maximum nested interpreter executions through ctx.exec (default: 64) */
  maxExecDepth?: number;

  /** Maximum function call/recursion depth (normal default: 100) */
  maxCallDepth?: number;

  /** Maximum number of commands to execute (normal default: 100000) */
  maxCommandCount?: number;

  /** Maximum loop iterations for bash while/for/until loops (normal default: 100000) */
  maxLoopIterations?: number;

  /** Maximum loop iterations for AWK while/for loops (normal default: 100000) */
  maxAwkIterations?: number;

  /** Maximum command iterations for SED branch loops (normal default: 100000) */
  maxSedIterations?: number;

  /** Maximum iterations for jq loops (normal default: 100000) */
  maxJqIterations?: number;

  /** Maximum jq/yq parser tokens (default: 100000) */
  maxQueryTokens?: number;

  /** Maximum jq/yq object/query traversal depth (default: 1000) */
  maxQueryDepth?: number;

  /** Maximum jq/yq result elements (default: 1000000) */
  maxQueryElements?: number;

  /** Maximum AWK parser tokens (default: 100000) */
  maxAwkParserTokens?: number;

  /** Maximum AWK parser nesting depth (default: 256) */
  maxAwkParserDepth?: number;

  /** Maximum AWK parser operations (default: 1000000) */
  maxAwkParserOperations?: number;

  /** Maximum parsed CSV rows (default: 1000000) */
  maxCsvRows?: number;

  /** Maximum parsed CSV cells (default: 10000000) */
  maxCsvCells?: number;

  /** Aggregate execution work units shared across nested execution (default: 1000000) */
  maxWorkUnits?: number;

  /** Maximum filesystem entries visited by one traversal (default: 1000000) */
  maxTraversalEntries?: number;

  /** Maximum filesystem traversal nesting depth (default: 1000) */
  maxTraversalDepth?: number;

  /** Maximum filesystem traversal operations (default: 1000000) */
  maxTraversalWork?: number;

  /** Maximum reserved live/intermediate bytes (default: 512 MiB) */
  maxLiveBytes?: number;

  /** Maximum aggregate input bytes (default: 512 MiB) */
  maxInputBytes?: number;

  /** Maximum bytes retained by Bash's default in-memory filesystem (default: 1 GiB) */
  maxFileSystemBytes?: number;

  /** Maximum SQLite database image bytes (default: 1 GiB) */
  maxDatabaseBytes?: number;

  /** Maximum SQLite result bytes before output formatting (default: 256 MiB) */
  maxDatabaseResultBytes?: number;

  /** Maximum aggregate expanded archive bytes (default: 1 GiB) */
  maxArchiveBytes?: number;

  /** Maximum compressed archive input bytes (default: 512 MiB) */
  maxArchiveCompressedBytes?: number;

  /** Maximum bytes in one archive entry (default: 512 MiB) */
  maxArchiveEntryBytes?: number;

  /** Maximum archive entries (default: 1000000) */
  maxArchiveEntries?: number;

  /** Maximum worker request or response payload bytes (default: 64 MiB) */
  maxWorkerMessageBytes?: number;

  /** Maximum top-level execution wall time in milliseconds (default: 1 hour) */
  maxExecutionTimeMs?: number;

  /**
   * Maximum time to let an aborted command acknowledge cancellation before its
   * execution context is revoked (normal default: 100ms).
   */
  maxExtensionCleanupTimeMs?: number;

  /** Maximum sqlite3 query execution time in milliseconds (normal default: 30000) */
  maxSqliteTimeoutMs?: number;

  /** Maximum Python execution time in milliseconds (normal default: 30000) */
  maxPythonTimeoutMs?: number;

  /** Maximum JavaScript execution time in milliseconds (normal default: 30000) */
  maxJsTimeoutMs?: number;

  /** Maximum glob filesystem operations (normal default: 1000000) */
  maxGlobOperations?: number;

  /** Maximum string length in bytes (normal default: 64 MiB) */
  maxStringLength?: number;

  /** Maximum array elements (normal default: 1000000) */
  maxArrayElements?: number;

  /** Maximum heredoc size in bytes (normal default: 64 MiB) */
  maxHeredocSize?: number;

  /** Maximum command substitution nesting depth (default: 50) */
  maxSubstitutionDepth?: number;

  /** Maximum brace expansion results (normal default: 100000) */
  maxBraceExpansionResults?: number;

  /** Maximum total output size in bytes (normal default: 256 MiB) */
  maxOutputSize?: number;

  /** Maximum number of open file descriptors (normal default: 4096) */
  maxFileDescriptors?: number;

  /** Maximum source/. nesting depth (default: 100) */
  maxSourceDepth?: number;
}

/** Named limit presets. `normal` favors compatibility; `hardened` is opt-in. */
export type ExecutionLimitProfile = "normal" | "hardened";

/** Liberal default shared by shell and standalone transform entry points. */
export const DEFAULT_MAX_SOURCE_BYTES: number = 64 * 1024 * 1024;

/**
 * Default execution limits.
 * These liberal compatibility defaults remain bounded. Select the hardened
 * profile for tighter untrusted-workload policy.
 */
const DEFAULT_LIMITS: Required<ExecutionLimits> = {
  maxSourceBytes: DEFAULT_MAX_SOURCE_BYTES,
  maxExecDepth: 64,
  maxCallDepth: 100,
  maxCommandCount: 100000,
  maxLoopIterations: 100000,
  maxAwkIterations: 100000,
  maxSedIterations: 100000,
  // Core query evaluation now shares one aggregate work counter. Keep the
  // normal profile liberal enough for large, ordinary data transforms.
  maxJqIterations: 10_000_000,
  maxQueryTokens: 100000,
  maxQueryDepth: 1000,
  maxQueryElements: 1000000,
  maxAwkParserTokens: 100000,
  maxAwkParserDepth: 256,
  maxAwkParserOperations: 1000000,
  maxCsvRows: 1000000,
  maxCsvCells: 10000000,
  // Aggregate across an entire exec(), including large CSV/query transforms.
  // Keep normal mode comfortably above the per-resource row/element limits;
  // hardened mode below provides the tighter untrusted-workload ceiling.
  maxWorkUnits: 100_000_000,
  maxTraversalEntries: 1_000_000,
  maxTraversalDepth: 1_000,
  maxTraversalWork: 1_000_000,
  maxLiveBytes: 512 * 1024 * 1024,
  maxInputBytes: 512 * 1024 * 1024,
  maxFileSystemBytes: 1024 * 1024 * 1024,
  maxDatabaseBytes: 1024 * 1024 * 1024,
  maxDatabaseResultBytes: 256 * 1024 * 1024,
  maxArchiveBytes: 1024 * 1024 * 1024,
  maxArchiveCompressedBytes: 512 * 1024 * 1024,
  maxArchiveEntryBytes: 512 * 1024 * 1024,
  maxArchiveEntries: 1000000,
  maxWorkerMessageBytes: 64 * 1024 * 1024,
  // Prior releases had no top-level deadline. Keep normal compatibility-safe
  // for long real workloads while retaining a finite defense-in-depth bound.
  maxExecutionTimeMs: 60 * 60 * 1000,
  maxExtensionCleanupTimeMs: 100,
  maxSqliteTimeoutMs: 30000,
  maxPythonTimeoutMs: 30000,
  maxJsTimeoutMs: 30000,
  maxGlobOperations: 1000000,
  maxStringLength: 64 * 1024 * 1024,
  maxArrayElements: 1000000,
  maxHeredocSize: 64 * 1024 * 1024,
  maxSubstitutionDepth: 50,
  maxBraceExpansionResults: 100000,
  maxOutputSize: 256 * 1024 * 1024,
  maxFileDescriptors: 4096,
  maxSourceDepth: 100,
};

const HARDENED_LIMITS: Required<ExecutionLimits> = {
  ...DEFAULT_LIMITS,
  maxSourceBytes: 8 * 1024 * 1024,
  maxCommandCount: 10_000,
  maxLoopIterations: 10_000,
  maxAwkIterations: 10_000,
  maxSedIterations: 10_000,
  maxJqIterations: 10_000,
  maxSqliteTimeoutMs: 5_000,
  maxPythonTimeoutMs: 10_000,
  maxJsTimeoutMs: 10_000,
  maxExtensionCleanupTimeMs: 25,
  maxGlobOperations: 100_000,
  maxStringLength: 10 * 1024 * 1024,
  maxArrayElements: 100_000,
  maxHeredocSize: 10 * 1024 * 1024,
  maxBraceExpansionResults: 10_000,
  maxOutputSize: 10 * 1024 * 1024,
  maxFileDescriptors: 1_024,
  maxQueryTokens: 25_000,
  maxQueryDepth: 256,
  maxQueryElements: 100_000,
  maxAwkParserTokens: 25_000,
  maxAwkParserDepth: 128,
  maxAwkParserOperations: 100_000,
  maxCsvRows: 100_000,
  maxCsvCells: 1_000_000,
  maxWorkUnits: 100_000,
  maxTraversalEntries: 100_000,
  maxTraversalDepth: 256,
  maxTraversalWork: 100_000,
  maxLiveBytes: 64 * 1024 * 1024,
  maxInputBytes: 32 * 1024 * 1024,
  maxFileSystemBytes: 128 * 1024 * 1024,
  maxDatabaseBytes: 64 * 1024 * 1024,
  maxDatabaseResultBytes: 16 * 1024 * 1024,
  maxArchiveBytes: 128 * 1024 * 1024,
  maxArchiveCompressedBytes: 64 * 1024 * 1024,
  maxArchiveEntryBytes: 64 * 1024 * 1024,
  maxArchiveEntries: 100_000,
  maxWorkerMessageBytes: 16 * 1024 * 1024,
  maxExecutionTimeMs: 30_000,
};

const HARD_LIMITS: Required<ExecutionLimits> = {
  maxSourceBytes: 4 * 1024 * 1024 * 1024,
  maxExecDepth: 10_000,
  maxCallDepth: 10_000,
  maxCommandCount: 10_000_000,
  maxLoopIterations: 10_000_000,
  maxAwkIterations: 10_000_000,
  maxSedIterations: 10_000_000,
  maxJqIterations: 10_000_000,
  maxQueryTokens: 100_000_000,
  maxQueryDepth: 100_000,
  maxQueryElements: 100_000_000,
  maxAwkParserTokens: 100_000_000,
  maxAwkParserDepth: 100_000,
  maxAwkParserOperations: 100_000_000,
  maxCsvRows: 100_000_000,
  maxCsvCells: 1_000_000_000,
  maxWorkUnits: 1_000_000_000,
  maxTraversalEntries: 100_000_000,
  maxTraversalDepth: 100_000,
  maxTraversalWork: 1_000_000_000,
  maxLiveBytes: 4 * 1024 * 1024 * 1024,
  maxInputBytes: 4 * 1024 * 1024 * 1024,
  maxFileSystemBytes: 4 * 1024 * 1024 * 1024,
  maxDatabaseBytes: 4 * 1024 * 1024 * 1024,
  maxDatabaseResultBytes: 4 * 1024 * 1024 * 1024,
  maxArchiveBytes: 4 * 1024 * 1024 * 1024,
  maxArchiveCompressedBytes: 4 * 1024 * 1024 * 1024,
  maxArchiveEntryBytes: 4 * 1024 * 1024 * 1024,
  maxArchiveEntries: 100_000_000,
  maxWorkerMessageBytes: 1024 * 1024 * 1024,
  maxExecutionTimeMs: 24 * 60 * 60 * 1000,
  maxExtensionCleanupTimeMs: 60_000,
  maxSqliteTimeoutMs: 3_600_000,
  maxPythonTimeoutMs: 3_600_000,
  maxJsTimeoutMs: 3_600_000,
  maxGlobOperations: 10_000_000,
  maxStringLength: 4 * 1024 * 1024 * 1024,
  maxArrayElements: 10_000_000,
  maxHeredocSize: 4 * 1024 * 1024 * 1024,
  maxSubstitutionDepth: 10_000,
  maxBraceExpansionResults: 10_000_000,
  maxOutputSize: 4 * 1024 * 1024 * 1024,
  maxFileDescriptors: 65_536,
  maxSourceDepth: 10_000,
};

/**
 * Resolve execution limits by merging user-provided limits with defaults.
 */
export function resolveLimits(
  userLimits?: ExecutionLimits,
  profile: ExecutionLimitProfile = "normal",
): Required<ExecutionLimits> {
  const defaults = profile === "hardened" ? HARDENED_LIMITS : DEFAULT_LIMITS;
  if (!userLimits) {
    return { ...defaults };
  }
  const resolved: Required<ExecutionLimits> = {
    maxSourceBytes: userLimits.maxSourceBytes ?? defaults.maxSourceBytes,
    maxExecDepth: userLimits.maxExecDepth ?? defaults.maxExecDepth,
    maxCallDepth: userLimits.maxCallDepth ?? defaults.maxCallDepth,
    maxCommandCount: userLimits.maxCommandCount ?? defaults.maxCommandCount,
    maxLoopIterations:
      userLimits.maxLoopIterations ?? defaults.maxLoopIterations,
    maxAwkIterations: userLimits.maxAwkIterations ?? defaults.maxAwkIterations,
    maxSedIterations: userLimits.maxSedIterations ?? defaults.maxSedIterations,
    maxJqIterations: userLimits.maxJqIterations ?? defaults.maxJqIterations,
    maxQueryTokens: userLimits.maxQueryTokens ?? defaults.maxQueryTokens,
    maxQueryDepth: userLimits.maxQueryDepth ?? defaults.maxQueryDepth,
    maxQueryElements:
      userLimits.maxQueryElements ??
      userLimits.maxArrayElements ??
      defaults.maxQueryElements,
    maxAwkParserTokens:
      userLimits.maxAwkParserTokens ?? defaults.maxAwkParserTokens,
    maxAwkParserDepth:
      userLimits.maxAwkParserDepth ?? defaults.maxAwkParserDepth,
    maxAwkParserOperations:
      userLimits.maxAwkParserOperations ?? defaults.maxAwkParserOperations,
    maxCsvRows:
      userLimits.maxCsvRows ??
      userLimits.maxArrayElements ??
      defaults.maxCsvRows,
    maxCsvCells: userLimits.maxCsvCells ?? defaults.maxCsvCells,
    maxWorkUnits: userLimits.maxWorkUnits ?? defaults.maxWorkUnits,
    maxTraversalEntries:
      userLimits.maxTraversalEntries ??
      userLimits.maxLoopIterations ??
      defaults.maxTraversalEntries,
    maxTraversalDepth:
      userLimits.maxTraversalDepth ?? defaults.maxTraversalDepth,
    maxTraversalWork:
      userLimits.maxTraversalWork ??
      userLimits.maxLoopIterations ??
      defaults.maxTraversalWork,
    maxLiveBytes: userLimits.maxLiveBytes ?? defaults.maxLiveBytes,
    maxInputBytes: userLimits.maxInputBytes ?? defaults.maxInputBytes,
    maxFileSystemBytes:
      userLimits.maxFileSystemBytes ?? defaults.maxFileSystemBytes,
    maxDatabaseBytes: userLimits.maxDatabaseBytes ?? defaults.maxDatabaseBytes,
    maxDatabaseResultBytes:
      userLimits.maxDatabaseResultBytes ?? defaults.maxDatabaseResultBytes,
    maxArchiveBytes: userLimits.maxArchiveBytes ?? defaults.maxArchiveBytes,
    maxArchiveCompressedBytes:
      userLimits.maxArchiveCompressedBytes ??
      defaults.maxArchiveCompressedBytes,
    maxArchiveEntryBytes:
      userLimits.maxArchiveEntryBytes ?? defaults.maxArchiveEntryBytes,
    maxArchiveEntries:
      userLimits.maxArchiveEntries ?? defaults.maxArchiveEntries,
    maxWorkerMessageBytes:
      userLimits.maxWorkerMessageBytes ?? defaults.maxWorkerMessageBytes,
    maxExecutionTimeMs:
      userLimits.maxExecutionTimeMs ?? defaults.maxExecutionTimeMs,
    maxExtensionCleanupTimeMs:
      userLimits.maxExtensionCleanupTimeMs ??
      defaults.maxExtensionCleanupTimeMs,
    maxSqliteTimeoutMs:
      userLimits.maxSqliteTimeoutMs ?? defaults.maxSqliteTimeoutMs,
    maxPythonTimeoutMs:
      userLimits.maxPythonTimeoutMs ?? defaults.maxPythonTimeoutMs,
    maxJsTimeoutMs: userLimits.maxJsTimeoutMs ?? defaults.maxJsTimeoutMs,
    maxGlobOperations:
      userLimits.maxGlobOperations ?? defaults.maxGlobOperations,
    maxStringLength: userLimits.maxStringLength ?? defaults.maxStringLength,
    maxArrayElements: userLimits.maxArrayElements ?? defaults.maxArrayElements,
    maxHeredocSize: userLimits.maxHeredocSize ?? defaults.maxHeredocSize,
    maxSubstitutionDepth:
      userLimits.maxSubstitutionDepth ?? defaults.maxSubstitutionDepth,
    maxBraceExpansionResults:
      userLimits.maxBraceExpansionResults ?? defaults.maxBraceExpansionResults,
    maxOutputSize: userLimits.maxOutputSize ?? defaults.maxOutputSize,
    maxFileDescriptors:
      userLimits.maxFileDescriptors ?? defaults.maxFileDescriptors,
    maxSourceDepth: userLimits.maxSourceDepth ?? defaults.maxSourceDepth,
  };

  for (const key of Object.keys(resolved) as (keyof ExecutionLimits)[]) {
    const value = resolved[key];
    const hardLimit = HARD_LIMITS[key];
    if (!Number.isSafeInteger(value) || value < 0 || value > hardLimit) {
      throw new RangeError(
        `${key} must be a non-negative safe integer no greater than ${hardLimit}`,
      );
    }
  }

  return resolved;
}
