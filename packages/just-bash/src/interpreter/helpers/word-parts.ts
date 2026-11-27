/**
 * Word Part Helper Functions
 *
 * Provides common operations on WordPart types to eliminate duplication
 * across expansion.ts and word-parser.ts.
 */

import type { WordPart } from "../../ast/types.js";

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
