/**
 * Coverage Tracking Exports
 */

export { FeatureCoverage, type CoverageSnapshot } from "./feature-coverage.js";
export {
  CoverageTracker,
  type CategoryReport,
  type CoverageReport,
  type CorpusEntry,
} from "./coverage-tracker.js";
export {
  ALL_KNOWN_FEATURES,
  AWK_EXPR_FEATURES,
  AWK_STMT_FEATURES,
  BASH_BUILTIN_FEATURES,
  BASH_CMD_FEATURES,
  BASH_EXPANSION_FEATURES,
  FEATURE_CATEGORIES,
  JQ_NODE_FEATURES,
  SED_CMD_FEATURES,
} from "./known-features.js";
