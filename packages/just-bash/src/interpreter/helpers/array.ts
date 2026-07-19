/**
 * Array helper functions for the interpreter.
 */

import type { WordNode } from "../../ast/types.js";
import type { InterpreterContext, ShellArray } from "../types.js";

export function cloneArray(array: ShellArray): ShellArray {
  return { kind: array.kind, elements: new Map(array.elements) };
}

export function cloneArrays(
  arrays: Map<string, ShellArray> | undefined,
): Map<string, ShellArray> {
  return new Map(
    Array.from(arrays ?? [], ([name, array]) => [name, cloneArray(array)]),
  );
}

export function getArray(
  ctx: InterpreterContext,
  arrayName: string,
): ShellArray | undefined {
  return ctx.state.arrays?.get(arrayName);
}

export function ensureArray(
  ctx: InterpreterContext,
  arrayName: string,
  kind: "indexed" | "associative" = "indexed",
): ShellArray {
  ctx.state.arrays ??= new Map();
  let array = ctx.state.arrays.get(arrayName);
  if (!array) {
    array = { kind, elements: new Map() };
    ctx.state.arrays.set(arrayName, array);
  }
  return array;
}

export function setArrayKind(
  ctx: InterpreterContext,
  arrayName: string,
  kind: "indexed" | "associative",
): ShellArray {
  const array = ensureArray(ctx, arrayName, kind);
  array.kind = kind;
  return array;
}

export function hasArray(ctx: InterpreterContext, arrayName: string): boolean {
  return ctx.state.arrays?.has(arrayName) ?? false;
}

export function getArrayElement(
  ctx: InterpreterContext,
  arrayName: string,
  key: string | number,
): string | undefined {
  return getArray(ctx, arrayName)?.elements.get(String(key));
}

export function hasArrayElement(
  ctx: InterpreterContext,
  arrayName: string,
  key: string | number,
): boolean {
  return getArray(ctx, arrayName)?.elements.has(String(key)) ?? false;
}

export function setArrayElement(
  ctx: InterpreterContext,
  arrayName: string,
  key: string | number,
  value: string,
  kind?: "indexed" | "associative",
): void {
  ensureArray(ctx, arrayName, kind).elements.set(String(key), value);
}

export function deleteArrayElement(
  ctx: InterpreterContext,
  arrayName: string,
  key: string | number,
): boolean {
  return getArray(ctx, arrayName)?.elements.delete(String(key)) ?? false;
}

export function deleteArray(ctx: InterpreterContext, arrayName: string): void {
  ctx.state.arrays?.delete(arrayName);
  ctx.state.associativeArrays?.delete(arrayName);
}

/**
 * Get all indices of an array, sorted in ascending order.
 * Indexed arrays are held in dedicated structured interpreter state.
 */
export function getArrayIndices(
  ctx: InterpreterContext,
  arrayName: string,
): number[] {
  const indices = Array.from(getArray(ctx, arrayName)?.elements.keys() ?? [])
    .filter((key) => /^(0|[1-9]\d*)$/.test(key))
    .map(Number);

  return indices.sort((a, b) => a - b);
}

/**
 * Clear all elements of an array from the environment.
 */
export function clearArray(ctx: InterpreterContext, arrayName: string): void {
  ensureArray(
    ctx,
    arrayName,
    ctx.state.associativeArrays?.has(arrayName) ? "associative" : "indexed",
  ).elements.clear();
}

/**
 * Get all keys of an associative array.
 * Associative keys are retained exactly in the array element map.
 */
export function getAssocArrayKeys(
  ctx: InterpreterContext,
  arrayName: string,
): string[] {
  return Array.from(getArray(ctx, arrayName)?.elements.keys() ?? []).sort();
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
  // First part should be a Glob with pattern like "[key]" or just "["
  //
  // Special cases:
  // 1. Nested brackets like [a[0]] are parsed as:
  //    - Glob with pattern "[a[0]" (the inner [ starts a new character class,
  //      which closes at the first ])
  //    - Literal with value "]=..." (the outer ] and the =)
  //
  // 2. Double-quoted keys like ["key"]= are parsed as:
  //    - Glob with pattern "[" (just the opening bracket)
  //    - DoubleQuoted with the key
  //    - Literal with value "]=" or "]+="
  //
  // We need to handle all these cases.

  if (first.type !== "Glob" || !first.pattern.startsWith("[")) {
    return null;
  }

  let key: string;
  let secondPart: WordNode["parts"][0] = second;
  let secondPartIndex = 1;

  // Check if this is a nested bracket case by looking at second.value
  // If second starts with "]", this is nested bracket case
  if (second.type === "Literal" && second.value.startsWith("]")) {
    // Nested bracket case: [a[0]]= is parsed as Glob("[a[0]") + Literal("]=...")
    // The key is first.pattern without leading [
    // For [a[0]]=10: first.pattern="[a[0]", second.value="]=10"
    // Key should be "a[0]"

    const afterBracket = second.value.slice(1); // Remove the leading ]

    if (afterBracket.startsWith("+=") || afterBracket.startsWith("=")) {
      // Good, we found the assignment operator
      key = first.pattern.slice(1);
    } else if (afterBracket === "") {
      // The ] was the whole second part, check third part for = or +=
      if (word.parts.length < 3) return null;
      const third = word.parts[2];
      if (third.type !== "Literal") return null;
      if (!third.value.startsWith("=") && !third.value.startsWith("+="))
        return null;
      key = first.pattern.slice(1);
      secondPart = third;
      secondPartIndex = 2;
    } else {
      // Not a valid keyed element pattern
      return null;
    }
  } else if (
    first.pattern === "[" &&
    (second.type === "DoubleQuoted" || second.type === "SingleQuoted")
  ) {
    // Double/single-quoted key case: ["key"]= or ['key']=
    // The key is in the second part, and third part should be ]=
    if (word.parts.length < 3) return null;
    const third = word.parts[2];
    if (third.type !== "Literal") return null;
    if (!third.value.startsWith("]=") && !third.value.startsWith("]+="))
      return null;

    // Extract key from the quoted part
    if (second.type === "SingleQuoted") {
      key = second.value;
    } else {
      // DoubleQuoted - extract literal content from inner parts
      key = "";
      for (const inner of second.parts) {
        if (inner.type === "Literal") {
          key += inner.value;
        } else if (inner.type === "Escaped") {
          key += inner.value;
        }
        // For now, skip variable expansions in keys (complex case)
      }
    }
    secondPart = third;
    secondPartIndex = 2;
  } else if (first.pattern.endsWith("]")) {
    // Normal case: [key]= where key has no nested brackets
    // Second part should be a Literal starting with "=" or "+="
    if (second.type !== "Literal") return null;
    if (!second.value.startsWith("=") && !second.value.startsWith("+="))
      return null;

    // Extract key from the Glob pattern (remove [ and ])
    key = first.pattern.slice(1, -1);
  } else {
    // Pattern doesn't end with ] and second doesn't start with ]
    // This is not a valid keyed element
    return null;
  }

  // Remove surrounding quotes from key
  key = unquoteKey(key);

  // Get the actual content after = or += from secondPart
  // secondPart is a Literal that either starts with "=" or "+=" directly,
  // or for nested brackets, starts with "]=" or "]+="
  let assignmentContent: string;
  if (secondPart.type !== "Literal") return null;

  if (secondPart.value.startsWith("]=")) {
    assignmentContent = secondPart.value.slice(1); // Remove leading ]
  } else if (secondPart.value.startsWith("]+=")) {
    assignmentContent = secondPart.value.slice(1); // Remove leading ]
  } else {
    assignmentContent = secondPart.value;
  }

  // Determine if this is an append operation
  const append = assignmentContent.startsWith("+=");
  if (!append && !assignmentContent.startsWith("=")) return null;

  // Extract value parts: everything after the = (or +=)
  // Convert BraceExpansion nodes to Literal nodes to prevent brace expansion
  // in keyed element values (bash behavior: a=([k]=-{a,b}-) keeps literal braces)
  const valueParts: WordNode["parts"] = [];

  // The second part may have content after the = sign
  const eqLen = append ? 2 : 1; // "+=" vs "="
  const afterEq = assignmentContent.slice(eqLen);
  if (afterEq) {
    valueParts.push({ type: "Literal", value: afterEq });
  }

  // Add remaining parts (parts[secondPartIndex+1], etc.)
  // Converting BraceExpansion to Literal
  for (let i = secondPartIndex + 1; i < word.parts.length; i++) {
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
