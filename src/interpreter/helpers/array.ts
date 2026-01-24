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
 * Parse a keyed array element from an AST WordNode like [key]=value or [key]+=value.
 * Returns { key, valueParts, append } where valueParts are the AST parts for the value.
 * Returns null if not a keyed element pattern.
 *
 * This is used to properly expand variables in the value part of keyed elements.
 */
export interface ParsedKeyedElement {
  key: string;
  valueParts: WordNode["parts"];
  append: boolean;
}

export function parseKeyedElementFromWord(
  word: WordNode,
): ParsedKeyedElement | null {
  if (word.parts.length < 2) return null;

  const first = word.parts[0];
  const second = word.parts[1];

  // Check for [key]= or [key]+= pattern
  // First part should be a Glob with pattern like "[key]"
  if (
    first.type !== "Glob" ||
    !first.pattern.startsWith("[") ||
    !first.pattern.endsWith("]")
  ) {
    return null;
  }

  // Second part should be a Literal starting with "=" or "+="
  if (second.type !== "Literal") return null;
  const append = second.value.startsWith("+=");
  if (!append && !second.value.startsWith("=")) return null;

  // Extract key from the Glob pattern (remove [ and ])
  let key = first.pattern.slice(1, -1);
  // Remove surrounding quotes from key
  key = unquoteKey(key);

  // Extract value parts: everything after the = (or +=)
  // Convert BraceExpansion nodes to Literal nodes to prevent brace expansion
  // in keyed element values (bash behavior: a=([k]=-{a,b}-) keeps literal braces)
  const valueParts: WordNode["parts"] = [];

  // The second part may have content after the = sign
  const eqLen = append ? 2 : 1; // "+=" vs "="
  const afterEq = second.value.slice(eqLen);
  if (afterEq) {
    valueParts.push({ type: "Literal", value: afterEq });
  }

  // Add remaining parts (parts[2], parts[3], etc.)
  // Converting BraceExpansion to Literal
  for (let i = 2; i < word.parts.length; i++) {
    const part = word.parts[i];
    if (part.type === "BraceExpansion") {
      // Convert brace expansion to literal string
      valueParts.push({ type: "Literal", value: braceToLiteral(part) });
    } else {
      valueParts.push(part);
    }
  }

  return { key, valueParts, append };
}

/**
 * Convert a BraceExpansion node back to its literal form.
 * e.g., {a,b,c} or {1..5}
 */
function braceToLiteral(part: {
  type: "BraceExpansion";
  items: Array<
    | {
        type: "Range";
        start: string | number;
        end: string | number;
        step?: number;
        startStr?: string;
        endStr?: string;
      }
    | { type: "Word"; word: WordNode }
  >;
}): string {
  const items = part.items.map((item) => {
    if (item.type === "Range") {
      // Use startStr/endStr if available, otherwise use start/end
      const startS = item.startStr ?? String(item.start);
      const endS = item.endStr ?? String(item.end);
      let range = `${startS}..${endS}`;
      if (item.step) range += `..${item.step}`;
      return range;
    }
    return wordToLiteralString(item.word);
  });
  return `{${items.join(",")}}`;
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
