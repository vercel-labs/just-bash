/**
 * Fuzzing Framework
 *
 * Property-based fuzzing for security testing of just-bash.
 */

// Configuration
export {
  createDefaultProgressLogger,
  createFcOptions,
  createFuzzConfig,
  createProgressReporter,
  createProgressTracker,
  DEFAULT_FUZZ_CONFIG,
  type FuzzingConfig,
  type FuzzProgress,
  type FuzzProgressCallback,
} from "./config.js";
// Corpus
export {
  ARITHMETIC_ATTACKS,
  type AttackCase,
  DOS_ATTACKS,
  getAttacksByCategory,
  getAttacksByExpected,
  INJECTION_ATTACKS,
  KNOWN_ATTACK_CORPUS,
  POLLUTION_ATTACKS,
  SANDBOX_ESCAPES,
} from "./corpus/known-attacks.js";

// Generators
export * from "./generators/index.js";
// Assertions
export {
  assertExecResultSafe,
  assertNoNativeCode,
  assertNoPollutionIndicators,
  assertOutputSafe,
  checkForNativeCode,
  checkForPollutionIndicators,
  checkOutputSecurity,
  type SecurityCheckResult,
} from "./oracles/assertions.js";
export {
  type DOSIssue,
  DOSOracle,
  type DOSOracleResult,
} from "./oracles/dos-oracle.js";
// Oracles
export {
  type SandboxIssue,
  SandboxOracle,
  type SandboxOracleResult,
} from "./oracles/sandbox-oracle.js";
// Runners
export { type FuzzResult, FuzzRunner } from "./runners/fuzz-runner.js";
