/**
 * Security Module - Defense-in-Depth Box
 *
 * This module provides a secondary defense layer that monkey-patches
 * dangerous JavaScript globals during bash script execution.
 *
 * IMPORTANT: This is a SECONDARY defense layer. It should never be relied upon
 * as the primary security mechanism. The primary security comes from proper
 * sandboxing, input validation, and architectural constraints.
 *
 * Usage:
 * ```typescript
 * import { Bash } from 'just-bash';
 *
 * // Enable defense-in-depth (recommended for production)
 * const bash = new Bash({
 *   defenseInDepth: true,
 * });
 *
 * // Or with custom configuration
 * const bash = new Bash({
 *   defenseInDepth: {
 *     enabled: true,
 *     auditMode: false,
 *     onViolation: (v) => console.warn('Violation:', v),
 *   },
 * });
 * ```
 */

// Main class
export {
  DefenseInDepthBox,
  SecurityViolationError,
} from "./defense-in-depth-box.js";

// Violation logger
export {
  createConsoleViolationCallback,
  SecurityViolationLogger,
  type SecurityViolationLoggerOptions,
  type ViolationSummary,
} from "./security-violation-logger.js";
// Types
export type {
  DefenseInDepthConfig,
  DefenseInDepthHandle,
  DefenseInDepthStats,
  SecurityViolation,
  SecurityViolationType,
} from "./types.js";
