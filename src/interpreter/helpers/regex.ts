/**
 * Regex helper functions for the interpreter.
 */

/**
 * Escape a string for use as a literal in a regex pattern.
 * All regex special characters are escaped.
 */
export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Escape a string for use inside a regex character class.
 * Used for IFS-based regex building.
 */
export function escapeRegexCharClass(str: string): string {
  return str.replace(/[-[\]{}()*+?.,\\^$|#]/g, "\\$&");
}
