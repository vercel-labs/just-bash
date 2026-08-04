/**
 * Brace Range Expansion
 *
 * Handles numeric {1..10} and character {a..z} range expansion.
 * These are pure functions with no external dependencies.
 */

import { utf8ByteLength } from "../../commands/printf/escapes.js";
import { BraceExpansionError, ExecutionLimitError } from "../errors.js";

// Maximum iterations for range expansion to prevent infinite loops
const MAX_SAFE_RANGE_ITERATIONS = 10000;

export interface BraceRangeLimits {
  maxResults: number;
  maxStringBytes: number;
}

const DEFAULT_RANGE_LIMITS: BraceRangeLimits = {
  maxResults: MAX_SAFE_RANGE_ITERATIONS,
  maxStringBytes: 10 * 1024 * 1024,
};

function pushRangeValue(
  results: string[],
  value: string,
  limits: BraceRangeLimits,
  aggregateBytes: { value: number },
): boolean {
  if (results.length >= limits.maxResults) {
    return false;
  }
  const bytes = utf8ByteLength(value);
  if (bytes > limits.maxStringBytes - aggregateBytes.value) {
    throw new ExecutionLimitError(
      `brace expansion string limit exceeded (${limits.maxStringBytes} bytes)`,
      "string_length",
    );
  }
  results.push(value);
  aggregateBytes.value += bytes;
  return true;
}

/**
 * Safely expand a numeric range with step, preventing infinite loops.
 * Returns array of string values, or null if the range is invalid.
 *
 * Bash behavior:
 * - When step is 0, treat it as 1
 * - When step direction is "wrong", use absolute value and go in natural direction
 * - Zero-padding: use the max width of start/end for padding
 */
function safeExpandNumericRange(
  start: number,
  end: number,
  rawStep: number | undefined,
  startStr?: string,
  endStr?: string,
  limits: BraceRangeLimits = DEFAULT_RANGE_LIMITS,
): string[] | null {
  // Step of 0 is treated as 1 in bash
  let step = rawStep ?? 1;
  if (step === 0) step = 1;

  // Use absolute value of step - bash ignores step sign and uses natural direction
  const absStep = Math.abs(step);

  const results: string[] = [];

  // Determine zero-padding width (max width of start or end if leading zeros)
  let padWidth = 0;
  if (startStr?.match(/^-?0\d/)) {
    padWidth = Math.max(padWidth, startStr.replace(/^-/, "").length);
  }
  if (endStr?.match(/^-?0\d/)) {
    padWidth = Math.max(padWidth, endStr.replace(/^-/, "").length);
  }
  if (padWidth > limits.maxStringBytes) {
    throw new ExecutionLimitError(
      `brace expansion padding limit exceeded (${limits.maxStringBytes} bytes)`,
      "string_length",
    );
  }

  const aggregateBytes = { value: 0 };

  const formatNum = (n: number): string => {
    if (padWidth > 0) {
      const neg = n < 0;
      const absStr = String(Math.abs(n)).padStart(padWidth, "0");
      return neg ? `-${absStr}` : absStr;
    }
    return String(n);
  };

  if (start <= end) {
    // Ascending range
    for (
      let i = start, count = 0;
      i <= end && count < MAX_SAFE_RANGE_ITERATIONS;
      i += absStep, count++
    ) {
      if (!pushRangeValue(results, formatNum(i), limits, aggregateBytes)) break;
    }
  } else {
    // Descending range (start > end)
    for (
      let i = start, count = 0;
      i >= end && count < MAX_SAFE_RANGE_ITERATIONS;
      i -= absStep, count++
    ) {
      if (!pushRangeValue(results, formatNum(i), limits, aggregateBytes)) break;
    }
  }

  return results;
}

/**
 * Safely expand a character range with step, preventing infinite loops.
 * Returns array of string values, or null if the range is invalid.
 * Throws BraceExpansionError for mixed case ranges (e.g., {z..A}).
 *
 * Bash behavior:
 * - When step is 0, treat it as 1
 * - When step direction is "wrong", use absolute value and go in natural direction
 * - Mixed case (e.g., {z..A}) is an error - throws BraceExpansionError
 */
function safeExpandCharRange(
  start: string,
  end: string,
  rawStep: number | undefined,
  limits: BraceRangeLimits = DEFAULT_RANGE_LIMITS,
): string[] | null {
  // Step of 0 is treated as 1 in bash
  let step = rawStep ?? 1;
  if (step === 0) step = 1;

  const startCode = start.charCodeAt(0);
  const endCode = end.charCodeAt(0);

  // Use absolute value of step - bash ignores step sign and uses natural direction
  const absStep = Math.abs(step);

  // Check for mixed case (upper to lower or vice versa) - invalid in bash
  const startIsUpper = start >= "A" && start <= "Z";
  const startIsLower = start >= "a" && start <= "z";
  const endIsUpper = end >= "A" && end <= "Z";
  const endIsLower = end >= "a" && end <= "z";

  if ((startIsUpper && endIsLower) || (startIsLower && endIsUpper)) {
    // Mixed case is an error in bash (produces no output, exit code 1)
    const stepPart = rawStep !== undefined ? `..${rawStep}` : "";
    throw new BraceExpansionError(
      `{${start}..${end}${stepPart}}: invalid sequence`,
    );
  }

  const results: string[] = [];
  const aggregateBytes = { value: 0 };

  if (startCode <= endCode) {
    // Ascending range
    for (
      let i = startCode, count = 0;
      i <= endCode && count < MAX_SAFE_RANGE_ITERATIONS;
      i += absStep, count++
    ) {
      if (
        !pushRangeValue(results, String.fromCharCode(i), limits, aggregateBytes)
      ) {
        break;
      }
    }
  } else {
    // Descending range
    for (
      let i = startCode, count = 0;
      i >= endCode && count < MAX_SAFE_RANGE_ITERATIONS;
      i -= absStep, count++
    ) {
      if (
        !pushRangeValue(results, String.fromCharCode(i), limits, aggregateBytes)
      ) {
        break;
      }
    }
  }

  return results;
}

/**
 * Result of a brace range expansion.
 * Either contains expanded values or a literal fallback for invalid ranges.
 */
export interface BraceRangeResult {
  expanded: string[] | null;
  literal: string;
}

/**
 * Unified brace range expansion helper.
 * Handles both numeric and character ranges, returning either expanded values
 * or a literal string for invalid ranges.
 */
export function expandBraceRange(
  start: number | string,
  end: number | string,
  step: number | undefined,
  startStr?: string,
  endStr?: string,
  limits: BraceRangeLimits = DEFAULT_RANGE_LIMITS,
): BraceRangeResult {
  const stepPart = step !== undefined ? `..${step}` : "";

  if (typeof start === "number" && typeof end === "number") {
    const expanded = safeExpandNumericRange(
      start,
      end,
      step,
      startStr,
      endStr,
      limits,
    );
    return {
      expanded,
      literal: `{${start}..${end}${stepPart}}`,
    };
  }

  if (typeof start === "string" && typeof end === "string") {
    const expanded = safeExpandCharRange(start, end, step, limits);
    return {
      expanded,
      literal: `{${start}..${end}${stepPart}}`,
    };
  }

  // Mismatched types - treat as invalid
  return {
    expanded: null,
    literal: `{${start}..${end}${stepPart}}`,
  };
}
