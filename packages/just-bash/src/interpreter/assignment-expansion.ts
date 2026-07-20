/**
 * Assignment Expansion Helpers
 *
 * Handles expansion of assignment arguments for local/declare/typeset builtins.
 * - Array assignments: name=(elem1 elem2 ...)
 * - Scalar assignments: name=value, name+=value, name[index]=value
 */

import type { WordNode } from "../ast/types.js";
import { utf8ByteLength } from "../commands/printf/escapes.js";
import { Parser } from "../parser/parser.js";
import { ExecutionLimitError } from "./errors.js";
import { applyAssignmentTildeExpansion } from "./expansion/tilde.js";
import { expandWord, expandWordWithGlob } from "./expansion.js";
import { wordToLiteralString } from "./helpers/array.js";
import type { InterpreterContext } from "./types.js";

/**
 * Check if a Word represents an array assignment (name=(...)) and expand it
 * while preserving quote structure for elements.
 * Returns the expanded string like "name=(elem1 elem2 ...)" or null if not an array assignment.
 */
export async function expandLocalArrayAssignment(
  ctx: InterpreterContext,
  word: WordNode,
): Promise<string | null> {
  // First, join all parts to check if this looks like an array assignment
  let fullLiteral = "";
  let fullLiteralBytes = 0;
  for (const part of word.parts) {
    const value = part.type === "Literal" ? part.value : "\x00";
    const bytes = utf8ByteLength(value);
    if (bytes > ctx.limits.maxStringLength - fullLiteralBytes) {
      throw new ExecutionLimitError(
        `array assignment string limit exceeded (${ctx.limits.maxStringLength} bytes)`,
        "string_length",
      );
    }
    fullLiteral += value;
    fullLiteralBytes += bytes;
  }
  const arrayMatch = fullLiteral.match(/^([a-zA-Z_][a-zA-Z0-9_]*)=\(/);
  if (!arrayMatch || !fullLiteral.endsWith(")")) {
    return null;
  }

  const name = arrayMatch[1];
  const elements: string[] = [];
  const literalElements: boolean[] = [];
  let inArrayContent = false;
  let pendingLiteral = "";
  let pendingBytes = 0;
  let elementBytes = 0;
  // Track whether we've seen a quoted part (SingleQuoted, DoubleQuoted) since
  // last element push. This ensures empty quoted strings like '' are preserved.
  let hasQuotedContent = false;
  let isLiteralElement = true;

  const appendPending = (value: string): void => {
    const bytes = utf8ByteLength(value);
    if (bytes > ctx.limits.maxStringLength - elementBytes - pendingBytes) {
      throw new ExecutionLimitError(
        `array assignment string limit exceeded (${ctx.limits.maxStringLength} bytes)`,
        "string_length",
      );
    }
    pendingLiteral += value;
    pendingBytes += bytes;
  };

  const pushElement = (value: string, literal = false): void => {
    if (elements.length >= ctx.limits.maxArrayElements) {
      throw new ExecutionLimitError(
        `array assignment element limit exceeded (${ctx.limits.maxArrayElements})`,
        "array_elements",
      );
    }
    const bytes = utf8ByteLength(value);
    if (bytes > ctx.limits.maxStringLength - elementBytes) {
      throw new ExecutionLimitError(
        `array assignment string limit exceeded (${ctx.limits.maxStringLength} bytes)`,
        "string_length",
      );
    }
    elements.push(value);
    literalElements.push(literal);
    elementBytes += bytes;
  };

  const flushPending = (): void => {
    pushElement(pendingLiteral, isLiteralElement);
    pendingLiteral = "";
    pendingBytes = 0;
    hasQuotedContent = false;
    isLiteralElement = true;
  };

  for (const part of word.parts) {
    if (part.type === "Literal") {
      let value = part.value;
      if (!inArrayContent) {
        // Look for =( to start array content
        const idx = value.indexOf("=(");
        if (idx !== -1) {
          inArrayContent = true;
          value = value.slice(idx + 2);
        }
      }

      if (inArrayContent) {
        // Check for closing )
        if (value.endsWith(")")) {
          value = value.slice(0, -1);
        }

        // Process literal content: split by whitespace
        // But handle the case where this literal is adjacent to a quoted part
        for (const char of value) {
          if (/\s/.test(char)) {
            // Whitespace - push pending element if we have content OR saw quoted part
            if (pendingLiteral || hasQuotedContent) {
              flushPending();
            }
          } else {
            // Non-empty token - accumulate
            appendPending(char);
          }
        }
      }
    } else if (inArrayContent) {
      // Handle BraceExpansion specially - it produces multiple values
      // BUT only if we're not inside a keyed element [key]=value
      if (part.type === "BraceExpansion") {
        // Check if pendingLiteral looks like a keyed element pattern: [key]=...
        // If so, brace expansion should NOT happen in the value part
        const isKeyedElement = /^\[.+\]=/.test(pendingLiteral);
        if (isKeyedElement) {
          // Inside a keyed element value - convert brace to literal, no expansion
          appendPending(
            wordToLiteralString({
              type: "Word",
              parts: [part],
            }),
          );
        } else {
          // Plain element - expand braces normally
          // Push any pending literal first
          if (pendingLiteral || hasQuotedContent) {
            flushPending();
          }
          // Use expandWordWithGlob to properly expand brace expressions
          const braceExpanded = await expandWordWithGlob(ctx, {
            type: "Word",
            parts: [part],
          });
          // Add each expanded value as a separate element
          for (const value of braceExpanded.values) pushElement(value);
        }
      } else {
        // Quoted/expansion part - expand it and accumulate as single element
        // Mark that we've seen quoted content (for empty string preservation)
        if (
          part.type === "SingleQuoted" ||
          part.type === "DoubleQuoted" ||
          part.type === "Escaped"
        ) {
          hasQuotedContent = true;
        }
        isLiteralElement = false;
        const expanded = await expandWord(ctx, {
          type: "Word",
          parts: [part],
        });
        appendPending(expanded);
      }
    }
  }

  // Push final element if we have content OR saw quoted part
  if (pendingLiteral || hasQuotedContent) {
    flushPending();
  }

  // Array literals are tokenized manually above because the outer parser keeps
  // `name=(...)` together in several declaration contexts. Complete the two
  // assignment-context expansions that therefore have not yet run: brace
  // expansion for literal elements, and tilde expansion after keyed `=` and
  // `:` separators. Never re-expand values produced by substitutions.
  const originalElements = elements.splice(0);
  const originalLiteralElements = literalElements.splice(0);
  elementBytes = 0;
  for (let index = 0; index < originalElements.length; index++) {
    let element = originalElements[index];
    if (!originalLiteralElements[index]) {
      pushElement(element);
      continue;
    }

    const keyedMatch = element.match(/^(\[[^\]]+\]=)(.*)$/s);
    if (keyedMatch) {
      const expandedValue = applyAssignmentTildeExpansion(ctx, keyedMatch[2]);
      element = keyedMatch[1] + expandedValue;
    }

    if (element.includes("{") && element.includes("}")) {
      const parsed = new Parser().parseWordFromString(element, false, false);
      if (parsed.parts.some((part) => part.type === "BraceExpansion")) {
        const expanded = await expandWordWithGlob(ctx, parsed);
        for (const value of expanded.values) pushElement(value);
        continue;
      }
    }
    pushElement(element);
  }

  // Build result string with proper quoting
  const resultChunks = [`${name}=(`];
  let resultBytes = utf8ByteLength(resultChunks[0]);
  for (let index = 0; index < elements.length; index++) {
    const elem = elements[index];
    // Don't quote keyed elements like ['key']=value or [index]=value
    // These need to be parsed by the declare builtin as-is
    let quoted: string;
    if (/^\[.+\]=/.test(elem)) {
      quoted = elem;
    } else if (elem === "") {
      // Empty strings must be quoted to be preserved
      quoted = "''";
    } else if (
      /[\s"'\\$`!*?[\]{}|&;<>()]/.test(elem) &&
      !elem.startsWith("'") &&
      !elem.startsWith('"')
    ) {
      // Use single quotes, escaping existing single quotes
      quoted = `'${elem.replace(/'/g, "'\\''")}'`;
    } else {
      quoted = elem;
    }

    const fragment = `${index > 0 ? " " : ""}${quoted}`;
    const bytes = utf8ByteLength(fragment);
    if (bytes + 1 > ctx.limits.maxStringLength - resultBytes) {
      throw new ExecutionLimitError(
        `array assignment string limit exceeded (${ctx.limits.maxStringLength} bytes)`,
        "string_length",
      );
    }
    resultChunks.push(fragment);
    resultBytes += bytes;
  }
  resultChunks.push(")");

  return resultChunks.join("");
}

/**
 * Check if a Word represents a scalar assignment (name=value, name+=value, or name[index]=value)
 * and expand it WITHOUT glob expansion on the value part.
 * Returns the expanded string like "name=expanded_value" or null if not a scalar assignment.
 *
 * This is important for bash compatibility: `local var=$x` where x='a b' should
 * set var to "a b", not try to glob-expand it.
 */
export async function expandScalarAssignmentArg(
  ctx: InterpreterContext,
  word: WordNode,
): Promise<string | null> {
  // Look for = in the word parts to detect assignment pattern
  // We need to find where the assignment operator is and split there
  let eqPartIndex = -1;
  let eqCharIndex = -1;
  let isAppend = false;

  for (let i = 0; i < word.parts.length; i++) {
    const part = word.parts[i];
    if (part.type === "Literal") {
      // Check for += first
      const appendIdx = part.value.indexOf("+=");
      if (appendIdx !== -1) {
        // Verify it looks like an assignment: should have valid var name before +=
        const before = part.value.slice(0, appendIdx);
        if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(before)) {
          eqPartIndex = i;
          eqCharIndex = appendIdx;
          isAppend = true;
          break;
        }
        // Also check for array index append: name[index]+=
        if (/^[a-zA-Z_][a-zA-Z0-9_]*\[[^\]]+\]$/.test(before)) {
          eqPartIndex = i;
          eqCharIndex = appendIdx;
          isAppend = true;
          break;
        }
      }
      // Check for regular = (but not == or != or other operators)
      const eqIdx = part.value.indexOf("=");
      if (eqIdx !== -1 && (eqIdx === 0 || part.value[eqIdx - 1] !== "+")) {
        // Make sure it's not inside brackets like [0]= which we handle separately
        // and verify it looks like an assignment
        const before = part.value.slice(0, eqIdx);
        if (
          /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(before) ||
          /^[a-zA-Z_][a-zA-Z0-9_]*\[[^\]]+\]$/.test(before)
        ) {
          eqPartIndex = i;
          eqCharIndex = eqIdx;
          break;
        }
      }
    }
  }

  // No assignment operator found
  if (eqPartIndex === -1) {
    return null;
  }

  // Split the word into name part and value part
  const nameParts = word.parts.slice(0, eqPartIndex);
  const eqPart = word.parts[eqPartIndex];

  if (eqPart.type !== "Literal") {
    return null;
  }

  const operatorLen = isAppend ? 2 : 1;
  const nameFromEqPart = eqPart.value.slice(0, eqCharIndex);
  const valueFromEqPart = eqPart.value.slice(eqCharIndex + operatorLen);
  const valueParts = word.parts.slice(eqPartIndex + 1);

  // Construct the name by expanding the name parts (no glob needed for names)
  let name = "";
  for (const part of nameParts) {
    name += await expandWord(ctx, { type: "Word", parts: [part] });
  }
  name += nameFromEqPart;

  // Construct the value part Word for expansion WITHOUT glob
  const valueWord: WordNode = {
    type: "Word",
    parts:
      valueFromEqPart !== ""
        ? [{ type: "Literal", value: valueFromEqPart }, ...valueParts]
        : valueParts,
  };

  // Expand the value WITHOUT glob expansion
  const value =
    valueWord.parts.length > 0 ? await expandWord(ctx, valueWord) : "";

  const operator = isAppend ? "+=" : "=";
  return `${name}${operator}${value}`;
}
