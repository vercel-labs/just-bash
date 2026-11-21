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
  }
  // Empty string is always falsy
  if (val === "") {
    return false;
  }
  // Only the exact string "0" is falsy (canonical representation of zero)
  // Other numeric-looking strings like "00", "0.0" are truthy as strings
  if (val === "0") {
    return false;
  }
  // All other non-empty strings are truthy
  return true;
}

/**
 * Convert an AWK value to a number.
 * Strings are parsed as floats, empty/non-numeric strings become 0.
 */
export function toNumber(val: AwkValue): number {
  if (typeof val === "number") return val;
  const n = parseFloat(val);
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
 * Check if a value looks like a number for comparison purposes.
 */
export function looksLikeNumber(val: AwkValue): boolean {
  if (typeof val === "number") return true;
  const s = String(val).trim();
  if (s === "") return false;
  return !Number.isNaN(Number(s));
}

// The longest valid AWK numeric prefix of a string: an optional sign,
// digits with an optional fraction (or a leading-dot fraction), and an
// optional exponent. Unlike parseFloat/Number, this rejects the
// spellings AWK does not treat as numeric at all ("Infinity", "0x10").
const AWK_NUMBER_PREFIX = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/;
const AWK_NUMERIC_STRING = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/**
 * True when a string is an AWK numeric string (strnum): after trimming
 * surrounding whitespace it is exactly a decimal number. "Infinity"
 * and "0x10" are not numeric strings in AWK, even though JavaScript's
 * Number() accepts them.
 */
export function isAwkNumericString(val: AwkValue): boolean {
  if (typeof val === "number") return true;
  return AWK_NUMERIC_STRING.test(val.trim());
}

/**
 * Convert a value to a number the way AWK does: a string contributes
 * its leading numeric prefix ("1a" -> 1, "  12 " -> 12) and a string
 * with no numeric prefix is 0 ("Infinity" -> 0, "0x10" -> 0). An
 * overflowed exponent keeps JavaScript's Infinity, as gawk's +inf.
 */
export function awkParseNumber(val: AwkValue): number {
  if (typeof val === "number") return val;
  const s = val.trimStart();
  if (!AWK_NUMBER_PREFIX.test(s)) return 0;
  const n = parseFloat(s);
  return Number.isNaN(n) ? 0 : n;
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
