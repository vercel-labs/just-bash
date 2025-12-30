/**
 * AWK Type Conversion Helpers
 *
 * Pure functions for type conversion and truthiness checking.
 */

import type { AwkValue } from "./types.js";

/**
 * Check if a value is truthy in AWK.
 * Numbers are truthy if non-zero, strings if non-empty.
 */
export function isTruthy(val: AwkValue): boolean {
  if (typeof val === "number") {
    return val !== 0;
  }
  return val !== "";
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

/**
 * Test if a string matches a regex pattern.
 */
export function matchRegex(pattern: string, text: string): boolean {
  try {
    return new RegExp(pattern).test(text);
  } catch {
    return false;
  }
}
