/**
 * Centralized regex handling for user-provided patterns.
 *
 * This module provides ReDoS-safe regex execution for all user-provided patterns.
 * Matching runs through a pluggable RegexEngine; re2js is the default.
 *
 * Usage:
 *   import { createUserRegex, UserRegex } from '../regex/index.js';
 *
 *   // For user-provided patterns (from grep, sed, awk, bash =~, etc.)
 *   const regex = createUserRegex(userPattern, 'gi');
 *   const matches = regex.match(input);
 *
 *   // For internal patterns (that we control), you can still use RegExp directly
 *   const internalRegex = /^[a-z]+$/;
 */

export {
  type CompiledRegex,
  type RegexEngine,
  type RegexEngineFlags,
  type RegexMatcher,
  RegexSyntaxError,
} from "./engine.js";
export {
  currentRegexEngine,
  runWithRegexEngine,
  supportsRegexEngineOption,
} from "./engine-context.js";
export { re2jsEngine } from "./re2js-engine.js";
export {
  ConstantRegex,
  createUserRegex,
  type RegexLike,
  type ReplaceCallback,
  UserRegex,
  type UserRegexLimits,
} from "./user-regex.js";
