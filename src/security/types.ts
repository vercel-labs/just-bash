/**
 * Security Types for Defense-in-Depth Box
 *
 * These types define the configuration and behavior of the defense-in-depth
 * security layer that protects against code execution escape vectors.
 *
 * IMPORTANT: This is a SECONDARY defense layer. It should never be relied upon
 * as the primary security mechanism. The primary security comes from proper
 * sandboxing, input validation, and architectural constraints.
 */

/**
 * Configuration for the defense-in-depth box.
 */
export interface DefenseInDepthConfig {
  /**
   * Enable or disable the defense layer. Default: true
   */
  enabled?: boolean;

  /**
   * Audit mode: log violations but don't block them.
   * Useful for debugging and testing without breaking execution.
   * Default: false
   */
  auditMode?: boolean;

  /**
   * Callback invoked when a security violation is detected.
   * Called regardless of auditMode setting.
   */
  onViolation?: (violation: SecurityViolation) => void;

  /**
   * Violation types to exclude from blocking.
   * Use this when certain globals are required for legitimate purposes
   * (e.g., WebAssembly for sql.js in sqlite3 worker).
   */
  excludeViolationTypes?: SecurityViolationType[];
}

/**
 * Types of security violations that can be detected.
 */
/**
 * Types of security violations that can be detected.
 *
 * Note: We focus on code execution vectors. We don't block:
 * - process: Needed for Node.js operation (process.nextTick, etc.)
 * - require: May not exist in ESM, and import() can't be blocked this way
 */
export type SecurityViolationType =
  | "function_constructor"
  | "eval"
  | "setTimeout"
  | "setInterval"
  | "setImmediate"
  | "async_function_constructor"
  | "generator_function_constructor"
  | "async_generator_function_constructor"
  | "weak_ref"
  | "finalization_registry"
  | "reflect"
  | "proxy"
  | "process_env"
  | "process_binding"
  | "process_dlopen"
  | "process_main_module"
  | "module_load"
  | "webassembly"
  | "shared_array_buffer"
  | "atomics"
  | "error_prepare_stack_trace";

/**
 * Information about a detected security violation.
 */
export interface SecurityViolation {
  /**
   * Timestamp when the violation occurred (milliseconds since epoch).
   */
  timestamp: number;

  /**
   * Type of violation detected.
   */
  type: SecurityViolationType;

  /**
   * Human-readable message describing the violation.
   */
  message: string;

  /**
   * Path to the blocked global (e.g., "globalThis.Function").
   */
  path: string;

  /**
   * Stack trace at the point of violation, if available.
   */
  stack?: string;

  /**
   * Execution ID from AsyncLocalStorage context, for correlation.
   */
  executionId?: string;
}

/**
 * Statistics about defense-in-depth box activity.
 */
export interface DefenseInDepthStats {
  /**
   * Total number of violations blocked.
   */
  violationsBlocked: number;

  /**
   * List of all violations detected (capped to prevent memory issues).
   */
  violations: SecurityViolation[];

  /**
   * Total time the defense layer has been active in milliseconds.
   */
  activeTimeMs: number;

  /**
   * Current reference count (number of nested activations).
   */
  refCount: number;
}

/**
 * Handle returned by activate() for scoped execution.
 * Use the run() method to execute code within the protected context.
 */
export interface DefenseInDepthHandle {
  /**
   * Run code within the protected AsyncLocalStorage context.
   * All async descendants of the provided function will be tracked.
   *
   * @param fn - Async function to execute in the protected context
   * @returns Promise resolving to the function's return value
   */
  run: <T>(fn: () => Promise<T>) => Promise<T>;

  /**
   * Deactivate the defense layer. Must be called in a finally block.
   * Decrements ref count; patches are restored when count hits 0.
   */
  deactivate: () => void;

  /**
   * Unique identifier for this execution context.
   * Useful for correlating violations with specific exec() calls.
   */
  executionId: string;
}
