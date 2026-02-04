/**
 * UserRegex - Centralized regex handling for user-provided patterns
 *
 * This module provides a single point of control for all user-provided regex
 * execution. Currently uses native JavaScript RegExp, but designed to be
 * swapped to RE2 (via re2js) for ReDoS protection.
 *
 * All user-provided regex patterns should go through this module.
 * Internal patterns (those we control) can use ConstantRegex for the same interface.
 */

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

/**
 * A wrapper around RegExp that can be swapped to RE2 in the future.
 * Provides the same interface as RegExp for easy migration.
 */
export class UserRegex implements RegexLike {
  private readonly _regex: RegExp;
  private readonly _pattern: string;
  private readonly _flags: string;

  constructor(pattern: string, flags = "") {
    this._pattern = pattern;
    this._flags = flags;
    // TODO: Replace with RE2JS for ReDoS protection
    // import { RE2JS } from 're2js';
    // this._regex = RE2JS.compile(pattern, flags);
    this._regex = new RegExp(pattern, flags);
  }

  /**
   * Test if the pattern matches the input string.
   */
  test(input: string): boolean {
    // Reset lastIndex for global regexes to ensure consistent behavior
    if (this._regex.global) {
      this._regex.lastIndex = 0;
    }
    return this._regex.test(input);
  }

  /**
   * Execute the pattern against the input string.
   * Returns match array with capture groups, or null if no match.
   */
  exec(input: string): RegExpExecArray | null {
    return this._regex.exec(input);
  }

  /**
   * Match the input string against the pattern.
   * With global flag, returns all matches. Without, returns first match with groups.
   */
  match(input: string): RegExpMatchArray | null {
    // Reset lastIndex for consistent behavior
    if (this._regex.global) {
      this._regex.lastIndex = 0;
    }
    return input.match(this._regex);
  }

  /**
   * Replace matches in the input string.
   * @param input - The string to search in
   * @param replacement - A string or callback function
   */
  replace(input: string, replacement: string | ReplaceCallback): string {
    // Reset lastIndex for global regexes
    if (this._regex.global) {
      this._regex.lastIndex = 0;
    }
    // TypeScript needs help here - the callback signature is compatible
    return input.replace(
      this._regex,
      replacement as (substring: string, ...args: unknown[]) => string,
    );
  }

  /**
   * Split the input string by the pattern.
   */
  split(input: string, limit?: number): string[] {
    return input.split(this._regex, limit);
  }

  /**
   * Search for the pattern in the input string.
   * Returns the index of the first match, or -1 if not found.
   */
  search(input: string): number {
    return input.search(this._regex);
  }

  /**
   * Get all matches using an iterator (for global regexes).
   */
  *matchAll(input: string): IterableIterator<RegExpMatchArray> {
    if (!this._regex.global) {
      throw new Error("matchAll requires global flag");
    }
    this._regex.lastIndex = 0;
    let match = this._regex.exec(input);
    while (match !== null) {
      yield match;
      // Prevent infinite loop on zero-length matches
      if (match[0].length === 0) {
        this._regex.lastIndex++;
      }
      match = this._regex.exec(input);
    }
  }

  /**
   * Get the underlying RegExp object.
   * Use sparingly - prefer the wrapper methods for future RE2 compatibility.
   */
  get native(): RegExp {
    return this._regex;
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
    return this._regex.global;
  }

  /**
   * Check if this is a case-insensitive regex.
   */
  get ignoreCase(): boolean {
    return this._regex.ignoreCase;
  }

  /**
   * Check if this is a multiline regex.
   */
  get multiline(): boolean {
    return this._regex.multiline;
  }

  /**
   * Get/set lastIndex for global regexes.
   */
  get lastIndex(): number {
    return this._regex.lastIndex;
  }

  set lastIndex(value: number) {
    this._regex.lastIndex = value;
  }
}

/**
 * Create a UserRegex from a pattern string and flags.
 * This is the primary entry point for user-provided regex patterns.
 *
 * @param pattern - The regex pattern string
 * @param flags - Optional regex flags (g, i, m, s, u)
 * @returns A UserRegex instance
 * @throws Error if the pattern is invalid
 */
export function createUserRegex(pattern: string, flags = ""): UserRegex {
  return new UserRegex(pattern, flags);
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
