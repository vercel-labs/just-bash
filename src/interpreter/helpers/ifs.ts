/**
 * IFS (Internal Field Separator) Handling
 *
 * Centralized utilities for IFS-based word splitting used by:
 * - Word expansion (unquoted variable expansion)
 * - read builtin
 * - ${!prefix*} and ${!arr[*]} expansions
 */

/** Default IFS value: space, tab, newline */
const DEFAULT_IFS = " \t\n";

/**
 * Get the effective IFS value from environment.
 * Returns DEFAULT_IFS if IFS is undefined, or the actual value (including empty string).
 */
export function getIfs(env: Record<string, string>): string {
  return env.IFS ?? DEFAULT_IFS;
}

/**
 * Check if IFS is set to empty string (disables word splitting).
 */
export function isIfsEmpty(env: Record<string, string>): boolean {
  return env.IFS === "";
}

/**
 * Build a regex-safe pattern from IFS characters for use in character classes.
 * E.g., for IFS=" \t\n", returns " \\t\\n" (escaped for [pattern] use)
 */
export function buildIfsCharClassPattern(ifs: string): string {
  return ifs
    .split("")
    .map((c) => {
      // Escape regex special chars for character class
      if (/[\\^$.*+?()[\]{}|-]/.test(c)) return `\\${c}`;
      if (c === "\t") return "\\t";
      if (c === "\n") return "\\n";
      return c;
    })
    .join("");
}

/**
 * Build a RegExp for matching one or more IFS characters.
 * Used internally for splitting strings by IFS.
 */
function buildIfsRegex(ifs: string, flags?: string): RegExp {
  const pattern = buildIfsCharClassPattern(ifs);
  return new RegExp(`[${pattern}]+`, flags);
}

/**
 * Build a RegExp for matching leading IFS characters.
 */
function buildLeadingIfsRegex(ifs: string): RegExp {
  const pattern = buildIfsCharClassPattern(ifs);
  return new RegExp(`^[${pattern}]+`);
}

/**
 * Build a RegExp for matching trailing IFS characters.
 */
function buildTrailingIfsRegex(ifs: string): RegExp {
  const pattern = buildIfsCharClassPattern(ifs);
  return new RegExp(`[${pattern}]+$`);
}

/**
 * Get the first character of IFS (used for joining with $* and ${!prefix*}).
 * Returns space if IFS is undefined, empty string if IFS is empty.
 */
export function getIfsSeparator(env: Record<string, string>): string {
  const ifs = env.IFS;
  if (ifs === undefined) return " ";
  return ifs[0] || "";
}

/**
 * Split a string by IFS, handling leading/trailing IFS properly.
 * Returns words and their start positions in the original string.
 *
 * @param value - String to split
 * @param ifs - IFS characters to split on
 * @returns Object with words array and wordStarts array
 */
export function splitByIfs(
  value: string,
  ifs: string,
): { words: string[]; wordStarts: number[] } {
  // Empty IFS means no splitting
  if (ifs === "") {
    return { words: [value], wordStarts: [0] };
  }

  const words: string[] = [];
  const wordStarts: number[] = [];
  const ifsRegex = buildIfsRegex(ifs, "g");

  let lastEnd = 0;

  // Strip leading IFS
  const leadingMatch = value.match(buildLeadingIfsRegex(ifs));
  if (leadingMatch) {
    lastEnd = leadingMatch[0].length;
  }

  // Find words separated by IFS
  ifsRegex.lastIndex = lastEnd;
  let match = ifsRegex.exec(value);

  while (match !== null) {
    if (match.index > lastEnd) {
      wordStarts.push(lastEnd);
      words.push(value.substring(lastEnd, match.index));
    }
    lastEnd = ifsRegex.lastIndex;
    match = ifsRegex.exec(value);
  }

  // Capture final word if any
  if (lastEnd < value.length) {
    wordStarts.push(lastEnd);
    words.push(value.substring(lastEnd));
  }

  return { words, wordStarts };
}

/**
 * Strip trailing IFS characters from a string.
 */
export function stripTrailingIfs(value: string, ifs: string): string {
  if (ifs === "") return value;
  return value.replace(buildTrailingIfsRegex(ifs), "");
}
