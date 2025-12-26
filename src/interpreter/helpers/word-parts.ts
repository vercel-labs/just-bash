/**
 * Word Part Helper Functions
 *
 * Provides common operations on WordPart types to eliminate duplication
 * across expansion.ts and word-parser.ts.
 */

import type { WordPart } from "../../ast/types.js";

/**
 * Part types that contain a simple literal value accessible via part.value
 */
export const LITERAL_PART_TYPES: Set<string> = new Set([
  "Literal",
  "SingleQuoted",
  "Escaped",
]);

/**
 * Part types that are inherently quoted (content should not be glob-expanded)
 */
export const QUOTED_PART_TYPES: Set<string> = new Set([
  "SingleQuoted",
  "Escaped",
]);

/**
 * Get the literal string value from a word part.
 * Returns the value for Literal, SingleQuoted, and Escaped parts.
 * Returns null for complex parts that require expansion.
 */
export function getLiteralValue(part: WordPart): string | null {
  switch (part.type) {
    case "Literal":
      return part.value;
    case "SingleQuoted":
      return part.value;
    case "Escaped":
      return part.value;
    default:
      return null;
  }
}

/**
 * Check if a word part is "quoted" - meaning glob characters should be treated literally.
 * A part is quoted if it is:
 * - SingleQuoted
 * - Escaped
 * - DoubleQuoted (entirely quoted)
 * - Literal with empty value (doesn't affect quoting)
 */
export function isQuotedPart(part: WordPart): boolean {
  switch (part.type) {
    case "SingleQuoted":
    case "Escaped":
    case "DoubleQuoted":
      return true;
    case "Literal":
      // Empty literals don't affect quoting
      return part.value === "";
    default:
      // Unquoted expansions like $var are not quoted
      return false;
  }
}
