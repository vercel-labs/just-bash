/**
 * Pluggable engine behind UserRegex.
 *
 * Every user-provided pattern (grep, sed, awk, jq, `[[ =~ ]]`, …) is compiled
 * and matched through one engine. The default is re2js, a pure-JS RE2 port,
 * which runs everywhere just-bash runs. A host may give a `Bash` instance
 * another engine — e.g. a native RE2 binding on Node — via
 * `new Bash({ regexEngine })` to trade portability for speed.
 *
 * Security contract for any installed engine: matching must be linear in the
 * input length for every pattern the engine accepts. UserRegex's ReDoS
 * protection is exactly this property; an engine that backtracks removes it.
 */

export interface RegexEngineFlags {
  ignoreCase: boolean;
  multiline: boolean;
  dotAll: boolean;
  /** JavaScript `u`: the pattern uses Unicode escapes such as `\u{1F600}`. */
  unicode: boolean;
}

/**
 * Cursor over one input string. A cursor rather than an allocated match object
 * because UserRegex drives many matches per line (`s///g`, `gsub`) and the
 * default engine can serve them allocation-free; the accessors below are only
 * meaningful after a `find` that returned true, and UserRegex never calls them
 * otherwise.
 */
export interface RegexMatcher {
  /**
   * Search for the next match at or after `start` (default 0). Returns false —
   * and leaves the cursor without a current match — when there is none or when
   * `start` is past the end of the input.
   */
  find(start?: number): boolean;
  /** Start offset of the current match (`group` 0) or of a capture group. */
  start(group?: number): number;
  /** End offset (exclusive) of the current match or of a capture group. */
  end(group?: number): number;
  /**
   * Text of the current match (`index` 0) or of a capture group; null when the
   * group did not participate or `index` exceeds the pattern's group count.
   */
  group(index?: number): string | null;
  /**
   * Every group of the current match: `[0]` is the whole match, then one entry
   * per capture group in pattern order, null for non-participating groups.
   * Allocates, so UserRegex calls it only where it builds a result array.
   */
  groups(): (string | null)[];
  /**
   * Named groups of the current match, name → text (null when the group did
   * not participate). Empty when the pattern has no named groups.
   */
  namedGroups(): Record<string, string | null>;
  /** Point at a new input and rewind, reusing this matcher's allocations. */
  reset(input: string): void;
}

export interface CompiledRegex {
  matcher(input: string): RegexMatcher;
}

export interface RegexEngine {
  /**
   * `pattern` is in JavaScript RegExp syntax. Throws RegexSyntaxError when the
   * pattern is invalid or uses a feature the engine does not support.
   */
  compile(pattern: string, flags: RegexEngineFlags): CompiledRegex;
}

export class RegexSyntaxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RegexSyntaxError";
  }
}
