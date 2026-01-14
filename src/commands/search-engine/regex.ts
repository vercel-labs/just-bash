/**
 * Regex building utilities for search commands
 */

export type RegexMode = "basic" | "extended" | "fixed" | "perl";

export interface RegexOptions {
  mode: RegexMode;
  ignoreCase?: boolean;
  wholeWord?: boolean;
  lineRegexp?: boolean;
  multiline?: boolean;
  /** Makes . match newlines in multiline mode (ripgrep --multiline-dotall) */
  multilineDotall?: boolean;
}

/**
 * Build a JavaScript RegExp from a pattern with the specified mode
 */
export function buildRegex(pattern: string, options: RegexOptions): RegExp {
  let regexPattern: string;

  switch (options.mode) {
    case "fixed":
      // Escape all regex special characters for literal match
      regexPattern = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      break;
    case "extended":
    case "perl":
      // Convert (?P<name>...) to JavaScript's (?<name>...) syntax
      regexPattern = pattern.replace(/\(\?P<([^>]+)>/g, "(?<$1>");
      break;
    default:
      regexPattern = escapeRegexForBasicGrep(pattern);
      break;
  }

  if (options.wholeWord) {
    // Wrap in non-capturing group to handle alternation properly
    // e.g., min|max should become \b(?:min|max)\b, not \bmin|max\b
    // Use (?<!\w) and (?!\w) instead of \b to handle non-word characters
    // This ensures patterns like '.' match individual non-word chars correctly
    regexPattern = `(?<![\\w])(?:${regexPattern})(?![\\w])`;
  }
  if (options.lineRegexp) {
    regexPattern = `^${regexPattern}$`;
  }

  // Build flags:
  // - g: global matching
  // - i: case insensitive
  // - m: multiline (^ and $ match at line boundaries)
  // - s: dotall (. matches newlines)
  const flags =
    "g" +
    (options.ignoreCase ? "i" : "") +
    (options.multiline ? "m" : "") +
    (options.multilineDotall ? "s" : "");
  return new RegExp(regexPattern, flags);
}

/**
 * Convert replacement string syntax to JavaScript's String.replace format
 *
 * Conversions:
 * - $0 and ${0} -> $& (full match)
 * - $name -> $<name> (named capture groups)
 * - ${name} -> $<name> (braced named capture groups)
 * - Preserves $1, $2, etc. for numbered groups
 */
export function convertReplacement(replacement: string): string {
  // First, convert $0 and ${0} to $& (use $$& to produce literal $& in output)
  let result = replacement.replace(/\$\{0\}|\$0(?![0-9])/g, "$$&");

  // Convert ${name} to $<name> for non-numeric names
  result = result.replace(/\$\{([^0-9}][^}]*)\}/g, "$$<$1>");

  // Convert $name to $<name> for non-numeric names (not followed by > which would already be converted)
  // Match $name where name starts with letter or underscore and contains word chars
  result = result.replace(/\$([a-zA-Z_][a-zA-Z0-9_]*)(?![>0-9])/g, "$$<$1>");

  return result;
}

/**
 * Convert Basic Regular Expression (BRE) to JavaScript regex
 *
 * In BRE:
 * - \| is alternation (becomes | in JS)
 * - \( \) are groups (become ( ) in JS)
 * - \{ \} are quantifiers (kept as literals for simplicity)
 * - + ? | ( ) { } are literal (must be escaped in JS)
 */
function escapeRegexForBasicGrep(str: string): string {
  let result = "";
  let i = 0;

  while (i < str.length) {
    const char = str[i];

    if (char === "\\" && i + 1 < str.length) {
      const nextChar = str[i + 1];
      // BRE: \| becomes | (alternation)
      // BRE: \( \) become ( ) (grouping)
      if (nextChar === "|" || nextChar === "(" || nextChar === ")") {
        result += nextChar;
        i += 2;
        continue;
      } else if (nextChar === "{" || nextChar === "}") {
        // Keep as escaped for now (literal)
        result += `\\${nextChar}`;
        i += 2;
        continue;
      }
    }

    // Escape characters that are special in JavaScript regex but not in BRE
    if (
      char === "+" ||
      char === "?" ||
      char === "|" ||
      char === "(" ||
      char === ")" ||
      char === "{" ||
      char === "}"
    ) {
      result += `\\${char}`;
    } else {
      result += char;
    }
    i++;
  }

  return result;
}
