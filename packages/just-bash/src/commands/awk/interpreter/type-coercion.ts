/**
 * AWK Type Conversion Helpers
 *
 * Pure functions for type conversion and truthiness checking.
 */

import { createUserRegex } from "../../../regex/index.js";
import type { AwkValue } from "./types.js";

/**
 * Check if a value is truthy in AWK.
 * - Numbers: truthy if non-zero
 * - Empty string: falsy
 * - String "0": falsy (canonical string representation of zero)
 * - All other non-empty strings: truthy (including "00", "0.0", etc.)
 */
export function isTruthy(val: AwkValue): boolean {
  if (typeof val === "number") {
    return val !== 0;
  // All other non-empty strings are truthy
  return true;
}

/**
 * Convert an AWK value to a number, the way AWK does: a string
 * contributes its leading numeric prefix ("1a" -> 1, "  12 " -> 12)
 * and a string with no numeric prefix is 0 ("Infinity" -> 0,
 * "0x10" -> 0). An overflowed exponent keeps JavaScript's Infinity,
 * as gawk's +inf ("1e400" -> Infinity). This is the single numeric
 * parser for arithmetic, comparisons, and asort: the old split
 * (parseFloat-based toNumber vs prefix-based awkParseNumber) made
 * sorting and math disagree on the same value.
 */
export function toNumber(val: AwkValue): number {
  if (typeof val === "number") return val;
  const s = val.trimStart();
  if (!AWK_NUMBER_PREFIX.test(s)) return 0;
  const n = parseFloat(s);
  return Number.isNaN(n) ? 0 : n;
}

/**
 * Convert an AWK value to a string.
 * Numbers are formatted without trailing zeros.
 */
export function toAwkString(val: AwkValue): string {
  if (typeof val === "string") return val;
  if (Number.isInteger(val)) return String(val);
  return String(val);
}

/**
  * Check if a value looks like a number for comparison purposes: a JS
 * number, or a string that is exactly a decimal number after
 * trimming. JavaScript's Number() accepts spellings AWK does not
 * treat as numeric ("Infinity", "0x10", "", " "), so those compare
 * as strings here, as in gawk.
 */
export function looksLikeNumber(val: AwkValue): boolean {
  if (typeof val === "number") return true;
  return isAwkNumericString(val);
}

 * and "0x10" are not numeric strings in AWK, even though JavaScript's
 * Number() accepts them.
 */
export function isAwkNumericString(val: AwkValue): boolean {
  if (typeof val === "number") return true;
  return AWK_NUMERIC_STRING.test(val.trim());
}

/**
 * Test if a string matches a regex pattern.
 */
export function matchRegex(pattern: string, text: string): boolean {
  try {
    return createUserRegex(pattern).test(text);
  } catch {
    return false;
  }
}
