/**
 * String builtin functions for the query engine.
 * These are extracted to reduce the size of the main evaluator.
 */

import type { QueryValue } from "./evaluator.js";

/**
 * Try to evaluate a simple string builtin that operates directly on the value.
 * Returns the result array if handled, or null if not a simple string builtin.
 */
export function tryEvalSimpleStringBuiltin(
  name: string,
  value: QueryValue,
): QueryValue[] | null {
  switch (name) {
    case "ascii_downcase":
      if (typeof value === "string") {
        return [
          value.replace(/[A-Z]/g, (c) =>
            String.fromCharCode(c.charCodeAt(0) + 32),
          ),
        ];
      }
      return [null];

    case "ascii_upcase":
      if (typeof value === "string") {
        return [
          value.replace(/[a-z]/g, (c) =>
            String.fromCharCode(c.charCodeAt(0) - 32),
          ),
        ];
      }
      return [null];

    case "trim":
      if (typeof value === "string") return [value.trim()];
      throw new Error("trim input must be a string");

    case "ltrim":
      if (typeof value === "string") return [value.trimStart()];
      throw new Error("trim input must be a string");

    case "rtrim":
      if (typeof value === "string") return [value.trimEnd()];
      throw new Error("trim input must be a string");

    case "explode":
      if (typeof value === "string") {
        return [Array.from(value).map((c) => c.codePointAt(0))];
      }
      return [null];

    case "tostring":
      if (typeof value === "string") return [value];
      return [JSON.stringify(value)];

    default:
      return null;
  }
}

/**
 * Unicode replacement character for invalid code points in implode.
 */
const REPLACEMENT_CHAR = 0xfffd;

/**
 * Evaluate the implode builtin - converts array of code points to string.
 * Returns the result array if handled, or null if not implode.
 */
export function tryEvalImplode(
  name: string,
  value: QueryValue,
): QueryValue[] | null {
  if (name !== "implode") return null;

  if (!Array.isArray(value)) {
    throw new Error("implode input must be an array");
  }

  const chars = (value as QueryValue[]).map((cp) => {
    // Check for non-numeric values
    if (typeof cp === "string") {
      throw new Error(
        `string (${JSON.stringify(cp)}) can't be imploded, unicode codepoint needs to be numeric`,
      );
    }
    if (typeof cp !== "number" || Number.isNaN(cp)) {
      throw new Error(
        `number (null) can't be imploded, unicode codepoint needs to be numeric`,
      );
    }
    // Truncate to integer
    const code = Math.trunc(cp);
    // Check for valid Unicode code point
    // Valid range: 0 to 0x10FFFF, excluding surrogate pairs (0xD800-0xDFFF)
    if (code < 0 || code > 0x10ffff) {
      return String.fromCodePoint(REPLACEMENT_CHAR);
    }
    if (code >= 0xd800 && code <= 0xdfff) {
      return String.fromCodePoint(REPLACEMENT_CHAR);
    }
    return String.fromCodePoint(code);
  });

  return [chars.join("")];
}
