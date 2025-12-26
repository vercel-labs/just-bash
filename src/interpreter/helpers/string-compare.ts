/**
 * String comparison helpers for conditionals.
 *
 * Consolidates string comparison logic (=, ==, !=) used in:
 * - [[ ]] conditional expressions (with optional pattern matching)
 * - test/[ ] command (literal comparison only)
 */

import { matchPattern } from "../conditionals.js";

export type StringCompareOp = "=" | "==" | "!=";

/**
 * Check if an operator is a string comparison operator.
 */
export function isStringCompareOp(op: string): op is StringCompareOp {
  return op === "=" || op === "==" || op === "!=";
}

/**
 * Compare two strings using the specified operator.
 *
 * @param op - The comparison operator (=, ==, !=)
 * @param left - Left operand
 * @param right - Right operand
 * @param usePattern - If true, use glob pattern matching for equality (default: false)
 * @returns True if the comparison succeeds
 */
export function compareStrings(
  op: StringCompareOp,
  left: string,
  right: string,
  usePattern = false,
): boolean {
  const isEqual = usePattern ? matchPattern(left, right) : left === right;
  return op === "!=" ? !isEqual : isEqual;
}
