/**
 * Word Parsing Utilities
 *
 * String manipulation utilities for parsing words, expansions, and patterns.
 * These are pure functions extracted from the Parser class.
 */

import {
  type ArithmeticExpressionNode,
  AST,
  type RedirectionOperator,
  type WordNode,
  type WordPart,
} from "../ast/types.js";
import { parseArithmeticExpression } from "./arithmetic-parser.js";
import { TokenType } from "./lexer.js";
import type { Parser } from "./parser.js";

// =============================================================================
// PURE STRING UTILITIES
// =============================================================================

export function findTildeEnd(_p: Parser, value: string, start: number): number {
  let i = start + 1;
  while (i < value.length && /[a-zA-Z0-9_-]/.test(value[i])) {
    i++;
  }
  return i;
}

export function findMatchingBracket(
  _p: Parser,
  value: string,
  start: number,
  open: string,
  close: string,
): number {
  let depth = 1;
  let i = start + 1;

  while (i < value.length && depth > 0) {
    if (value[i] === open) depth++;
    else if (value[i] === close) depth--;
    if (depth > 0) i++;
  }

  return depth === 0 ? i : -1;
}

export function findParameterOperationEnd(
  _p: Parser,
  value: string,
  start: number,
): number {
  let i = start;
  let depth = 1;

  while (i < value.length && depth > 0) {
    const char = value[i];

    // Handle escape sequences - \X escapes the next character
    if (char === "\\" && i + 1 < value.length) {
      i += 2; // Skip escape and the escaped character
      continue;
    }

    // Handle single quotes - content is literal
    if (char === "'") {
      const closeIdx = value.indexOf("'", i + 1);
      if (closeIdx !== -1) {
        i = closeIdx + 1;
        continue;
      }
    }

    // Handle double quotes - content with escapes
    if (char === '"') {
      i++;
      while (i < value.length && value[i] !== '"') {
        if (value[i] === "\\" && i + 1 < value.length) {
          i += 2;
        } else {
          i++;
        }
      }
      if (i < value.length) i++; // Skip closing quote
      continue;
    }

    if (char === "{") depth++;
    else if (char === "}") depth--;
    if (depth > 0) i++;
  }

  return i;
}

export function findPatternEnd(
  _p: Parser,
  value: string,
  start: number,
): number {
  let i = start;

  // In bash, if the pattern starts with /, that / IS the pattern.
  // For ${x////c}: after //, the next / is the pattern, followed by / separator, then c
  // So we need to consume at least one character before treating / as a delimiter.
  let consumedAny = false;

  while (i < value.length) {
    const char = value[i];
    // Only break on / if we've consumed at least one character
    if ((char === "/" && consumedAny) || char === "}") break;

    // Handle single quotes - skip until closing quote
    if (char === "'") {
      const closeIdx = value.indexOf("'", i + 1);
      if (closeIdx !== -1) {
        i = closeIdx + 1;
        consumedAny = true;
        continue;
      }
    }

    // Handle double quotes - skip until closing quote (handling escapes)
    if (char === '"') {
      i++;
      while (i < value.length && value[i] !== '"') {
        if (value[i] === "\\" && i + 1 < value.length) {
          i += 2;
        } else {
          i++;
        }
      }
      if (i < value.length) i++; // Skip closing quote
      consumedAny = true;
      continue;
    }

    if (char === "\\") {
      i += 2;
      consumedAny = true;
    } else {
      i++;
      consumedAny = true;
    }
  }

  return i;
}

export function parseGlobPattern(
  _p: Parser,
  value: string,
  start: number,
): { pattern: string; endIndex: number } {
  let i = start;
  let pattern = "";

  while (i < value.length) {
    const char = value[i];

    if (char === "*" || char === "?") {
      pattern += char;
      i++;
    } else if (char === "[") {
      // Character class - need to properly find closing ]
      // Handle POSIX character classes like [[:alpha:]], [^[:alpha:]], etc.
      const closeIdx = findCharacterClassEnd(value, i);
      if (closeIdx === -1) {
        pattern += char;
        i++;
      } else {
        pattern += value.slice(i, closeIdx + 1);
        i = closeIdx + 1;
      }
    } else {
      break;
    }
  }

  return { pattern, endIndex: i };
}

/**
 * Find the closing ] of a character class, properly handling:
 * - POSIX character classes like [:alpha:], [:digit:], etc.
 * - Negation [^...]
 * - Literal ] at the start []] or [^]]
 * - Single quotes inside class (bash extension): [^'abc]'] contains literal ]
 */
function findCharacterClassEnd(value: string, start: number): number {
  let i = start + 1; // Skip opening [

  // Handle negation
  if (i < value.length && value[i] === "^") {
    i++;
  }

  // A ] immediately after [ or [^ is literal, not closing
  if (i < value.length && value[i] === "]") {
    i++;
  }

  while (i < value.length) {
    const char = value[i];

    // Handle escape sequences - \] should not end the class
    if (char === "\\" && i + 1 < value.length) {
      i += 2; // Skip both the backslash and the escaped character
      continue;
    }

    if (char === "]") {
      return i;
    }

    // If we encounter expansion or quote characters, this is NOT a valid glob
    // character class. In bash, ["$x"] is [ + "$x" + ], not a character class.
    if (char === '"' || char === "$" || char === "`") {
      return -1;
    }

    // Handle single quotes inside character class (bash extension)
    // [^'abc]'] - the ] inside quotes is literal, class ends at second ]
    if (char === "'") {
      const closeQuote = value.indexOf("'", i + 1);
      if (closeQuote !== -1) {
        i = closeQuote + 1;
        continue;
      }
    }

    // Handle POSIX character classes [:name:]
    if (char === "[" && i + 1 < value.length && value[i + 1] === ":") {
      // Find closing :]
      const closePos = value.indexOf(":]", i + 2);
      if (closePos !== -1) {
        i = closePos + 2;
        continue;
      }
    }

    // Handle collating symbols [.name.] and equivalence classes [=name=]
    if (
      char === "[" &&
      i + 1 < value.length &&
      (value[i + 1] === "." || value[i + 1] === "=")
    ) {
      const closeChar = value[i + 1];
      const closeSeq = `${closeChar}]`;
      const closePos = value.indexOf(closeSeq, i + 2);
      if (closePos !== -1) {
        i = closePos + 2;
        continue;
      }
    }

    i++;
  }

  return -1; // No closing ] found
}

export function parseAnsiCQuoted(
  _p: Parser,
  value: string,
  start: number,
): { part: WordPart; endIndex: number } {
  let result = "";
  let i = start;

  while (i < value.length && value[i] !== "'") {
    const char = value[i];

    if (char === "\\" && i + 1 < value.length) {
      const next = value[i + 1];
      switch (next) {
        case "n":
          result += "\n";
          i += 2;
          break;
        case "t":
          result += "\t";
          i += 2;
          break;
        case "r":
          result += "\r";
          i += 2;
          break;
        case "\\":
          result += "\\";
          i += 2;
          break;
        case "'":
          result += "'";
          i += 2;
          break;
        case '"':
          result += '"';
          i += 2;
          break;
        case "a":
          result += "\x07"; // bell
          i += 2;
          break;
        case "b":
          result += "\b"; // backspace
          i += 2;
          break;
        case "e":
        case "E":
          result += "\x1b"; // escape
          i += 2;
          break;
        case "f":
          result += "\f"; // form feed
          i += 2;
          break;
        case "v":
          result += "\v"; // vertical tab
          i += 2;
          break;
        case "x": {
          // \xHH - hex escape
          const hex = value.slice(i + 2, i + 4);
          const code = parseInt(hex, 16);
          if (!Number.isNaN(code)) {
            result += String.fromCharCode(code);
            i += 4;
          } else {
            result += "\\x";
            i += 2;
          }
          break;
        }
        case "u": {
          // \uHHHH - unicode escape
          const hex = value.slice(i + 2, i + 6);
          const code = parseInt(hex, 16);
          if (!Number.isNaN(code)) {
            result += String.fromCharCode(code);
            i += 6;
          } else {
            result += "\\u";
            i += 2;
          }
          break;
        }
        case "0":
        case "1":
        case "2":
        case "3":
        case "4":
        case "5":
        case "6":
        case "7": {
          // \NNN - octal escape
          let octal = "";
          let j = i + 1;
          while (j < value.length && j < i + 4 && /[0-7]/.test(value[j])) {
            octal += value[j];
            j++;
          }
          const code = parseInt(octal, 8);
          result += String.fromCharCode(code);
          i = j;
          break;
        }
        default:
          // Unknown escape, keep the backslash
          result += char;
          i++;
      }
    } else {
      result += char;
      i++;
    }
  }

  // Skip closing quote
  if (i < value.length && value[i] === "'") {
    i++;
  }

  return {
    part: AST.literal(result),
    endIndex: i,
  };
}

export function parseArithExprFromString(
  p: Parser,
  str: string,
): ArithmeticExpressionNode {
  // Trim whitespace - bash allows spaces around arithmetic expressions in slices
  const trimmed = str.trim();
  if (trimmed === "") {
    // Empty string means 0
    return {
      type: "ArithmeticExpression",
      expression: { type: "ArithNumber", value: 0 },
    };
  }
  // Use the full arithmetic expression parser
  return parseArithmeticExpression(p, trimmed);
}

/**
 * Split a brace expansion inner content by commas at the top level.
 * Handles nested braces like {a,{b,c},d} correctly.
 */
function splitBraceItems(inner: string): string[] {
  const items: string[] = [];
  let current = "";
  let depth = 0;

  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c === "{") {
      depth++;
      current += c;
    } else if (c === "}") {
      depth--;
      current += c;
    } else if (c === "," && depth === 0) {
      items.push(current);
      current = "";
    } else {
      current += c;
    }
  }
  items.push(current);
  return items;
}

export type WordPartsParser = (
  p: Parser,
  value: string,
  quoted?: boolean,
  singleQuoted?: boolean,
  isAssignment?: boolean,
) => WordPart[];

export function tryParseBraceExpansion(
  p: Parser,
  value: string,
  start: number,
  parseWordPartsFn?: WordPartsParser,
): { part: WordPart; endIndex: number } | null {
  // Find matching }
  const closeIdx = findMatchingBracket(p, value, start, "{", "}");
  if (closeIdx === -1) return null;

  const inner = value.slice(start + 1, closeIdx);

  // Check for range: {a..z} or {1..10} or {1..10..2}
  const rangeMatch = inner.match(/^(-?\d+)\.\.(-?\d+)(?:\.\.(-?\d+))?$/);
  if (rangeMatch) {
    return {
      part: {
        type: "BraceExpansion",
        items: [
          {
            type: "Range",
            start: Number.parseInt(rangeMatch[1], 10),
            end: Number.parseInt(rangeMatch[2], 10),
            step: rangeMatch[3]
              ? Number.parseInt(rangeMatch[3], 10)
              : undefined,
            // Store original strings for zero-padding support
            startStr: rangeMatch[1],
            endStr: rangeMatch[2],
          },
        ],
      },
      endIndex: closeIdx + 1,
    };
  }

  // Character ranges: {a..z} or {a..z..2}
  const charRangeMatch = inner.match(
    /^([a-zA-Z])\.\.([a-zA-Z])(?:\.\.(-?\d+))?$/,
  );
  if (charRangeMatch) {
    return {
      part: {
        type: "BraceExpansion",
        items: [
          {
            type: "Range",
            start: charRangeMatch[1],
            end: charRangeMatch[2],
            step: charRangeMatch[3]
              ? Number.parseInt(charRangeMatch[3], 10)
              : undefined,
          },
        ],
      },
      endIndex: closeIdx + 1,
    };
  }

  // Check for comma-separated list: {a,b,c}
  if (inner.includes(",") && parseWordPartsFn) {
    // Split by comma at top level (handling nested braces)
    const rawItems = splitBraceItems(inner);
    // Parse each item as a word with full expansion support
    const items = rawItems.map((s) => ({
      type: "Word" as const,
      word: AST.word(parseWordPartsFn(p, s, false, false, false)),
    }));
    return {
      part: { type: "BraceExpansion", items },
      endIndex: closeIdx + 1,
    };
  }

  // Legacy fallback: treat items as literals if no parser provided
  if (inner.includes(",")) {
    const rawItems = splitBraceItems(inner);
    const items = rawItems.map((s) => ({
      type: "Word" as const,
      word: AST.word([AST.literal(s)]),
    }));
    return {
      part: { type: "BraceExpansion", items },
      endIndex: closeIdx + 1,
    };
  }

  return null;
}

/**
 * Convert a WordNode back to a string representation.
 * Used for reconstructing array assignment strings for declare/local.
 */
export function wordToString(_p: Parser, word: WordNode): string {
  let result = "";
  for (const part of word.parts) {
    switch (part.type) {
      case "Literal":
      case "SingleQuoted":
      case "Escaped":
        result += part.value;
        break;
      case "DoubleQuoted":
        // For double-quoted parts, reconstruct them
        result += '"';
        for (const inner of part.parts) {
          if (inner.type === "Literal" || inner.type === "Escaped") {
            result += inner.value;
          } else if (inner.type === "ParameterExpansion") {
            result += `\${${inner.parameter}}`;
          }
        }
        result += '"';
        break;
      case "ParameterExpansion":
        result += `\${${part.parameter}}`;
        break;
      case "Glob":
        result += part.pattern;
        break;
      default:
        // For complex parts, just use a placeholder
        result += part.type;
    }
  }
  return result;
}

export function tokenToRedirectOp(
  _p: Parser,
  type: TokenType,
): RedirectionOperator {
  const map: Partial<Record<TokenType, RedirectionOperator>> = {
    [TokenType.LESS]: "<",
    [TokenType.GREAT]: ">",
    [TokenType.DGREAT]: ">>",
    [TokenType.LESSAND]: "<&",
    [TokenType.GREATAND]: ">&",
    [TokenType.LESSGREAT]: "<>",
    [TokenType.CLOBBER]: ">|",
    [TokenType.TLESS]: "<<<",
    [TokenType.AND_GREAT]: "&>",
    [TokenType.AND_DGREAT]: "&>>",
    [TokenType.DLESS]: "<", // Here-doc operator is <
    [TokenType.DLESSDASH]: "<",
  };
  return map[type] || ">";
}
