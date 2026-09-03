/**
 * UserRegex - Centralized regex handling for user-provided patterns
 *
 * This module provides a single point of control for all user-provided regex
 * execution. Matching goes through the execution's RegexEngine (re2js by
 * default) for ReDoS protection via linear-time matching.
 *
 * All user-provided regex patterns should go through this module.
 * Internal patterns (those we control) can use ConstantRegex for the same interface.
 */

import { BoundedStringBuilder } from "../bounded-builder.js";
import { ExecutionLimitError } from "../interpreter/errors.js";
import {
  type CompiledRegex,
  type RegexEngineFlags,
  type RegexMatcher,
  RegexSyntaxError,
} from "./engine.js";
import { currentRegexEngine } from "./engine-context.js";

const DEFAULT_MAX_REGEX_RESULTS = 1_000_000;
const DEFAULT_MAX_REGEX_OUTPUT_BYTES = 64 * 1024 * 1024;

export interface UserRegexLimits {
  maxResults?: number;
  maxOutputBytes?: number;
  signal?: AbortSignal;
}

/**
 * Type for replacement callback functions.
 * Matches the signature of String.prototype.replace callback.
 */
export type ReplaceCallback = (
  match: string,
  ...args: (string | number | Record<string, string>)[]
) => string;

/**
 * Common interface for regex wrappers.
 * Both UserRegex (for user patterns) and ConstantRegex (for internal patterns) implement this.
 */
export interface RegexLike {
  test(input: string): boolean;
  exec(input: string): RegExpExecArray | null;
  match(input: string): RegExpMatchArray | null;
  replace(input: string, replacement: string | ReplaceCallback): string;
  split(input: string, limit?: number): string[];
  search(input: string): number;
  matchAll(input: string): IterableIterator<RegExpMatchArray>;
  readonly native: RegExp;
  readonly source: string;
  readonly flags: string;
  readonly global: boolean;
  readonly ignoreCase: boolean;
  readonly multiline: boolean;
  lastIndex: number;
}

function engineFlagsFrom(flags: string): RegexEngineFlags {
  return {
    ignoreCase: flags.includes("i"),
    multiline: flags.includes("m"),
    dotAll: flags.includes("s"),
    unicode: flags.includes("u"),
  };
}

/**
 * A wrapper around the current execution's RegexEngine that provides a
 * RegExp-compatible interface. The engine guarantees linear-time matching,
 * providing ReDoS protection.
 */
export class UserRegex implements RegexLike {
  private readonly _compiled: CompiledRegex;
  private readonly _pattern: string;
  private readonly _flags: string;
  private readonly _global: boolean;
  private readonly _ignoreCase: boolean;
  private readonly _multiline: boolean;
  private _lastIndex = 0;
  // Cache native RegExp for compatibility - created lazily
  private _nativeRegex: RegExp | null = null;
  // Reusable matcher to avoid per-call allocation in tight grep loops.
  // Matcher allocation dominates regex.test/exec cost when called once per line
  // across thousands of lines.
  private _matcher: RegexMatcher | null = null;
  private readonly maxResults: number;
  private readonly maxOutputBytes: number;
  private readonly signal?: AbortSignal;

  private assertResultCount(count: number): void {
    if (this.signal?.aborted) throw new Error("regular expression aborted");
    if (count > this.maxResults) {
      throw new ExecutionLimitError(
        `regular expression result limit exceeded (${this.maxResults})`,
        "array_elements",
      );
    }
  }

  private expandReplacement(
    matcher: RegexMatcher,
    replacement: string,
  ): string {
    const output = new BoundedStringBuilder(
      this.maxOutputBytes,
      "regular expression replacement",
    );
    // Resolved on first use: most replacements are literal and the string
    // `s///g` path runs this once per match.
    let groups: (string | null)[] | undefined;
    let namedGroups: Record<string, string | null> | undefined;
    for (let index = 0; index < replacement.length; index++) {
      const char = replacement[index];
      if (char === "\\" && index + 1 < replacement.length) {
        output.append(replacement[++index]);
        continue;
      }
      if (char !== "$" || index + 1 >= replacement.length) {
        output.append(char);
        continue;
      }
      if (replacement[index + 1] === "{") {
        const end = replacement.indexOf("}", index + 2);
        if (end !== -1) {
          const name = replacement.slice(index + 2, end);
          namedGroups ??= matcher.namedGroups();
          if (name in namedGroups) {
            output.append(namedGroups[name] ?? "");
            index = end;
            continue;
          }
        }
      }
      if (/\d/.test(replacement[index + 1])) {
        groups ??= matcher.groups();
        const groupCount = groups.length - 1;
        let end = index + 1;
        let group = 0;
        while (end < replacement.length && /\d/.test(replacement[end])) {
          const candidate = group * 10 + Number(replacement[end]);
          if (candidate > groupCount) break;
          group = candidate;
          end++;
        }
        output.append(groups[group] ?? "");
        index = end - 1;
        continue;
      }
      output.append(char);
    }
    return output.build();
  }

  private captureGroups(matcher: RegexMatcher): string[] {
    return matcher.groups().slice(1) as string[];
  }

  // Null-prototype so a group named __proto__ cannot pollute the result.
  // `missing` stands in for groups that did not participate; null omits them.
  private namedGroupValues(
    matcher: RegexMatcher,
    missing: string | null,
  ): Record<string, string> | undefined {
    const entries = Object.entries(matcher.namedGroups());
    if (entries.length === 0) {
      return undefined;
    }
    const groups: Record<string, string> = Object.create(null);
    for (const [name, text] of entries) {
      const value = text ?? missing;
      if (value !== null) {
        groups[name] = value;
      }
    }
    return groups;
  }

  private buildMatchArray(
    matcher: RegexMatcher,
    input: string,
  ): RegExpExecArray {
    const result = [
      matcher.group(0) ?? "",
      ...this.captureGroups(matcher),
    ] as unknown as RegExpExecArray;
    result.index = matcher.start(0);
    result.input = input;
    const groups = this.namedGroupValues(matcher, null);
    if (groups) {
      result.groups = groups;
    }
    return result;
  }

  private acquireMatcher(input: string): RegexMatcher {
    if (this._matcher === null) {
      this._matcher = this._compiled.matcher(input);
      return this._matcher;
    }
    this._matcher.reset(input);
    return this._matcher;
  }

  constructor(pattern: string, flags = "", limits: UserRegexLimits = {}) {
    this._pattern = pattern;
    this._flags = flags;
    this._global = flags.includes("g");
    this._ignoreCase = flags.includes("i");
    this._multiline = flags.includes("m");
    this.maxResults = limits.maxResults ?? DEFAULT_MAX_REGEX_RESULTS;
    this.maxOutputBytes =
      limits.maxOutputBytes ?? DEFAULT_MAX_REGEX_OUTPUT_BYTES;
    this.signal = limits.signal;
    if (
      !Number.isSafeInteger(this.maxResults) ||
      this.maxResults < 0 ||
      !Number.isSafeInteger(this.maxOutputBytes) ||
      this.maxOutputBytes < 0
    ) {
      throw new Error("invalid regular expression limits");
    }

    try {
      this._compiled = currentRegexEngine().compile(
        pattern,
        engineFlagsFrom(flags),
      );
    } catch (e) {
      if (e instanceof RegexSyntaxError) {
        // Provide helpful error messages for unsupported RE2 features
        const msg = e.message || "";
        let explanation = "";

        if (
          msg.includes("(?=") ||
          msg.includes("(?!") ||
          msg.includes("(?<") ||
          msg.includes("(?<!") ||
          pattern.includes("(?=") ||
          pattern.includes("(?!") ||
          pattern.includes("(?<=") ||
          pattern.includes("(?<!")
        ) {
          explanation =
            " Lookahead (?=, ?!) and lookbehind (?<=, ?<!) assertions are not supported in this environment because the regex engine uses RE2 for ReDoS protection. RE2 guarantees linear-time matching but cannot support these features.";
        } else if (msg.includes("backreference") || /\\[1-9]/.test(pattern)) {
          explanation =
            " Backreferences (\\1, \\2, etc.) are not supported in this environment because the regex engine uses RE2 for ReDoS protection. RE2 guarantees linear-time matching but cannot support backreferences.";
        }

        throw new SyntaxError(
          `Invalid regular expression: /${pattern}/: ${msg}${explanation}`,
        );
      }
      throw e;
    }
  }

  /**
   * Test if the pattern matches the input string.
   */
  test(input: string): boolean {
    // Reset lastIndex for global regexes to ensure consistent behavior
    if (this._global) {
      this._lastIndex = 0;
    }
    const matcher = this.acquireMatcher(input);
    return matcher.find();
  }

  /**
   * Execute the pattern against the input string.
   * Returns match array with capture groups, or null if no match.
   */
  exec(input: string): RegExpExecArray | null {
    const matcher = this.acquireMatcher(input);

    // For global regex, start from lastIndex
    const startPos = this._global ? this._lastIndex : 0;
    if (!matcher.find(startPos)) {
      if (this._global) {
        this._lastIndex = 0;
      }
      return null;
    }

    const execResult = this.buildMatchArray(matcher, input);

    // Update lastIndex for global regex
    if (this._global) {
      this._lastIndex = matcher.end(0);
      // Handle zero-length matches
      if (matcher.start(0) === matcher.end(0)) {
        this._lastIndex++;
      }
    }

    return execResult;
  }

  /**
   * Match the input string against the pattern.
   * With global flag, returns all matches. Without, returns first match with groups.
   */
  match(input: string): RegExpMatchArray | null {
    // Reset lastIndex for consistent behavior
    if (this._global) {
      this._lastIndex = 0;
    }

    if (!this._global) {
      // Non-global: return first match with groups (same as exec)
      return this.exec(input);
    }

    // Global: return all matches without groups
    const matches: string[] = [];
    const matcher = this.acquireMatcher(input);
    let pos = 0;

    while (matcher.find(pos)) {
      const matchStr = matcher.group(0) ?? "";
      this.assertResultCount(matches.length + 1);
      matches.push(matchStr);
      pos = matcher.end(0);
      // Handle zero-length matches
      if (matcher.start(0) === matcher.end(0)) {
        pos++;
      }
      if (pos > input.length) break;
    }

    return matches.length > 0 ? (matches as RegExpMatchArray) : null;
  }

  /**
   * Replace matches in the input string.
   * @param input - The string to search in
   * @param replacement - A string or callback function
   */
  replace(input: string, replacement: string | ReplaceCallback): string {
    // Reset lastIndex for global regexes
    if (this._global) {
      this._lastIndex = 0;
    }

    if (typeof replacement === "string") {
      const matcher = this._compiled.matcher(input);
      const output = new BoundedStringBuilder(
        this.maxOutputBytes,
        "regular expression replacement",
      );
      let lastEnd = 0;
      let position = 0;
      let count = 0;
      while (matcher.find(position)) {
        this.assertResultCount(++count);
        const start = matcher.start(0);
        const end = matcher.end(0);
        output.append(input.slice(lastEnd, start));
        output.append(this.expandReplacement(matcher, replacement));
        lastEnd = end;
        position = end > start ? end : end + 1;
        if (!this._global || position > input.length) break;
      }
      output.append(input.slice(lastEnd));
      return output.build();
    }

    // Callback replacement - we need to do this manually.
    // Use a fresh Matcher rather than the shared cached one: the user-provided
    // callback may re-enter this same UserRegex instance (e.g. call test/exec/
    // replace), which would route through acquireMatcher and repoint the shared
    // matcher's charSequence to a different input. The next matcher.find(pos)
    // would then advance through the wrong string. A fresh matcher keeps the
    // iteration state private to this replace() call.
    const result = new BoundedStringBuilder(
      this.maxOutputBytes,
      "regular expression replacement",
    );
    const matcher = this._compiled.matcher(input);
    let lastEnd = 0;
    let pos = 0;
    let matchCount = 0;

    while (matcher.find(pos)) {
      this.assertResultCount(++matchCount);
      result.append(input.slice(lastEnd, matcher.start(0)));

      // Same argument list as String.prototype.replace hands its callback.
      const fullMatch = matcher.group(0) ?? "";
      const args: (string | number | Record<string, string>)[] = [
        ...this.captureGroups(matcher),
        matcher.start(0),
        input,
      ];
      const groups = this.namedGroupValues(matcher, "");
      if (groups) {
        args.push(groups);
      }

      // Capture positions before invoking callback. The matcher is private to
      // this call, but capturing now avoids relying on matcher state being
      // unchanged across the callback boundary.
      const matchStart = matcher.start(0);
      const matchEnd = matcher.end(0);

      result.append(replacement(fullMatch, ...args));

      lastEnd = matchEnd;
      pos = lastEnd;
      // Handle zero-length matches
      if (matchStart === matchEnd) {
        pos++;
      }

      if (!this._global) break;
      if (pos > input.length) break;
    }

    // Add remaining text
    result.append(input.slice(lastEnd));

    return result.build();
  }

  /**
   * Split the input string by the pattern.
   * Note: RE2JS split with limit includes remainder in last element (Java-style),
   * but JS split truncates to exactly limit elements. We implement JS behavior.
   */
  split(input: string, limit?: number): string[] {
    if (limit === 0) {
      return [];
    }
    const effectiveLimit =
      limit === undefined || limit < 0
        ? this.maxResults
        : Math.min(limit, this.maxResults);
    const result: string[] = [];
    const matcher = this._compiled.matcher(input);
    let lastEnd = 0;
    let searchFrom = 0;
    while (result.length < effectiveLimit && matcher.find(searchFrom)) {
      this.assertResultCount(result.length + 1);
      result.push(input.slice(lastEnd, matcher.start(0)));
      lastEnd = matcher.end(0);
      searchFrom =
        matcher.end(0) > matcher.start(0) ? matcher.end(0) : matcher.end(0) + 1;
    }
    if (result.length < effectiveLimit) result.push(input.slice(lastEnd));
    return result;
  }

  /**
   * Search for the pattern in the input string.
   * Returns the index of the first match, or -1 if not found.
   */
  search(input: string): number {
    const matcher = this.acquireMatcher(input);
    if (matcher.find()) {
      return matcher.start(0);
    }
    return -1;
  }

  /**
   * Get all matches using an iterator (for global regexes).
   */
  *matchAll(input: string): IterableIterator<RegExpMatchArray> {
    if (!this._global) {
      throw new Error("matchAll requires global flag");
    }

    this._lastIndex = 0;
    // matchAll is a generator that suspends at `yield`. The shared `_matcher`
    // would be corrupted if a caller interleaves any other method on the same
    // UserRegex instance between two `next()` calls (acquireMatcher would
    // reset/repoint it). Use a fresh Matcher to keep iterator state private.
    const matcher = this._compiled.matcher(input);
    let pos = 0;
    let resultCount = 0;

    while (matcher.find(pos)) {
      this.assertResultCount(++resultCount);
      yield this.buildMatchArray(matcher, input);

      pos = matcher.end(0);
      // Prevent infinite loop on zero-length matches
      if (matcher.start(0) === matcher.end(0)) {
        pos++;
      }
      if (pos > input.length) break;
    }
  }

  /**
   * Get the underlying RegExp object.
   * Creates a native RegExp lazily for compatibility with code that needs it.
   * Note: The native RegExp is only for compatibility - actual matching uses RE2.
   */
  get native(): RegExp {
    if (!this._nativeRegex) {
      // Create a native RegExp for compatibility
      // This may fail for RE2-specific patterns, but most patterns work
      try {
        this._nativeRegex = new RegExp(this._pattern, this._flags);
      } catch {
        // If the pattern doesn't work in native RegExp, create a dummy
        // that at least has the same source/flags
        this._nativeRegex = new RegExp("", this._flags);
        Object.defineProperty(this._nativeRegex, "source", {
          value: this._pattern,
          writable: false,
        });
      }
    }
    return this._nativeRegex;
  }

  /**
   * Get the pattern string.
   */
  get source(): string {
    return this._pattern;
  }

  /**
   * Get the flags string.
   */
  get flags(): string {
    return this._flags;
  }

  /**
   * Check if this is a global regex.
   */
  get global(): boolean {
    return this._global;
  }

  /**
   * Check if this is a case-insensitive regex.
   */
  get ignoreCase(): boolean {
    return this._ignoreCase;
  }

  /**
   * Check if this is a multiline regex.
   */
  get multiline(): boolean {
    return this._multiline;
  }

  /**
   * Get/set lastIndex for global regexes.
   */
  get lastIndex(): number {
    return this._lastIndex;
  }

  set lastIndex(value: number) {
    this._lastIndex = value;
  }
}

/**
 * Create a UserRegex from a pattern string and flags.
 * This is the primary entry point for user-provided regex patterns. The
 * pattern is compiled by the engine of the `Bash` execution this is called
 * from (`BashOptions.regexEngine`); outside any execution, or in the browser
 * build, that is re2js. Either way the engine matches in linear time, which is
 * the ReDoS protection.
 *
 * @param pattern - The regex pattern string
 * @param flags - Optional regex flags (g, i, m, s, u)
 * @returns A UserRegex instance
 * @throws Error if the pattern is invalid
 */
export function createUserRegex(
  pattern: string,
  flags = "",
  limits: UserRegexLimits = {},
): UserRegex {
  return new UserRegex(pattern, flags, limits);
}

/**
 * A wrapper around native RegExp for constant/internal patterns.
 * Use this for patterns we control (not user-provided) that don't need ReDoS protection.
 * Implements the same interface as UserRegex for consistency.
 */
export class ConstantRegex implements RegexLike {
  private readonly _regex: RegExp;

  constructor(regex: RegExp) {
    this._regex = regex;
  }

  test(input: string): boolean {
    if (this._regex.global) {
      this._regex.lastIndex = 0;
    }
    return this._regex.test(input);
  }

  exec(input: string): RegExpExecArray | null {
    return this._regex.exec(input);
  }

  match(input: string): RegExpMatchArray | null {
    if (this._regex.global) {
      this._regex.lastIndex = 0;
    }
    return input.match(this._regex);
  }

  replace(input: string, replacement: string | ReplaceCallback): string {
    if (this._regex.global) {
      this._regex.lastIndex = 0;
    }
    return input.replace(
      this._regex,
      replacement as (substring: string, ...args: unknown[]) => string,
    );
  }

  split(input: string, limit?: number): string[] {
    return input.split(this._regex, limit);
  }

  search(input: string): number {
    return input.search(this._regex);
  }

  *matchAll(input: string): IterableIterator<RegExpMatchArray> {
    if (!this._regex.global) {
      throw new Error("matchAll requires global flag");
    }
    this._regex.lastIndex = 0;
    let match = this._regex.exec(input);
    while (match !== null) {
      yield match;
      if (match[0].length === 0) {
        this._regex.lastIndex++;
      }
      match = this._regex.exec(input);
    }
  }

  get native(): RegExp {
    return this._regex;
  }

  get source(): string {
    return this._regex.source;
  }

  get flags(): string {
    return this._regex.flags;
  }

  get global(): boolean {
    return this._regex.global;
  }

  get ignoreCase(): boolean {
    return this._regex.ignoreCase;
  }

  get multiline(): boolean {
    return this._regex.multiline;
  }

  get lastIndex(): number {
    return this._regex.lastIndex;
  }

  set lastIndex(value: number) {
    this._regex.lastIndex = value;
  }
}
