/**
 * Array helper functions for the interpreter.
 */

import type { WordNode } from "../../ast/types.js";
import type { InterpreterContext } from "../types.js";

/**
 * Get all indices of an array, sorted in ascending order.
 * Arrays are stored as `name_0`, `name_1`, etc. in the environment.
 */
export function getArrayIndices(
  ctx: InterpreterContext,
  arrayName: string,
): number[] {
  const prefix = `${arrayName}_`;
  const indices: number[] = [];

  for (const key of Object.keys(ctx.state.env)) {
    if (key.startsWith(prefix)) {
      const indexStr = key.slice(prefix.length);
      const index = Number.parseInt(indexStr, 10);
      // Only include numeric indices (not __length or other metadata)
      if (!Number.isNaN(index) && String(index) === indexStr) {
        indices.push(index);
      }
    }
  }

  return indices.sort((a, b) => a - b);
}

/**
 * Clear all elements of an array from the environment.
 */
export function clearArray(ctx: InterpreterContext, arrayName: string): void {
  const prefix = `${arrayName}_`;
  for (const key of Object.keys(ctx.state.env)) {
    if (key.startsWith(prefix)) {
      delete ctx.state.env[key];
    }
  }
}

/**
 * Get all keys of an associative array.
 * For associative arrays, keys are stored as `name_key` where key is a string.
 */
export function getAssocArrayKeys(
  ctx: InterpreterContext,
  arrayName: string,
): string[] {
  const prefix = `${arrayName}_`;
  const keys: string[] = [];

  for (const envKey of Object.keys(ctx.state.env)) {
    if (envKey.startsWith(prefix) && !envKey.includes("__")) {
      const key = envKey.slice(prefix.length);
      keys.push(key);
    }
  }

  return keys.sort();
}

/**
 * Remove surrounding quotes from a key string.
 * Handles 'key' and "key" → key
 */
export function unquoteKey(key: string): string {
  if (
    (key.startsWith("'") && key.endsWith("'")) ||
    (key.startsWith('"') && key.endsWith('"'))
  ) {
    return key.slice(1, -1);
  }
  return key;
}

/**
 * Parse associative array element from a string like "[key]=value" or "[key]+=value"
 * Returns [key, value, append] where append is true for += syntax, null if no match.
 */
export function parseAssocArrayElement(
  str: string,
): [string, string, boolean] | null {
  // Match [key]+=value pattern (append syntax)
  const appendMatch = str.match(/^\[(.+?)\]\+=(.*)$/);
  if (appendMatch) {
    const key = unquoteKey(appendMatch[1]);
    const value = appendMatch[2];
    return [key, value, true];
  }

  // Match [key]=value pattern (regular assignment)
  const match = str.match(/^\[(.+?)\]=(.*)$/);
  if (!match) return null;

  const key = unquoteKey(match[1]);
  const value = match[2];

  return [key, value, false];
}

/**
 * Extract literal string content from a Word node (without expansion).
 * This is used for parsing associative array element syntax like [key]=value
 * where the [key] part may be parsed as a Glob.
 */
export function wordToLiteralString(word: WordNode): string {
  let result = "";
  for (const part of word.parts) {
    switch (part.type) {
      case "Literal":
        result += part.value;
        break;
      case "Glob":
        // Glob patterns in assoc array syntax are actually literal keys
        result += part.pattern;
        break;
      case "SingleQuoted":
        result += part.value;
        break;
      case "DoubleQuoted":
        // For double-quoted parts, recursively extract literals
        for (const inner of part.parts) {
          if (inner.type === "Literal") {
            result += inner.value;
          } else if (inner.type === "Escaped") {
            result += inner.value;
          }
          // Skip variable expansions etc. for now
        }
        break;
      case "Escaped":
        result += part.value;
        break;
      case "BraceExpansion":
        // For brace expansions in array element context, convert to literal
        // e.g., {a,b} becomes literal "{a,b}"
        result += "{";
        result += part.items
          .map((item) =>
            item.type === "Range"
              ? `${item.startStr}..${item.endStr}${item.step ? `..${item.step}` : ""}`
              : wordToLiteralString(item.word),
          )
          .join(",");
        result += "}";
        break;
      case "TildeExpansion":
        // Convert TildeExpansion node back to ~ or ~user literal
        // The caller will handle actual tilde expansion
        result += "~";
        if (part.user) {
          result += part.user;
        }
        break;
      // Skip other types (parameter expansions, command substitutions, etc.)
    }
  }
  return result;
}
