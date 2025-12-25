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

  while (i < value.length) {
    const char = value[i];
    if (char === "/" || char === "}") break;
    if (char === "\\") i += 2;
    else i++;
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
      // Character class
      const closeIdx = value.indexOf("]", i + 1);
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
  _p: Parser,
  str: string,
): ArithmeticExpressionNode {
  // Simple arithmetic expression parser
  // For now, just wrap in a node - full parsing happens during interpretation
  return {
    type: "ArithmeticExpression",
    expression: { type: "ArithNumber", value: Number.parseInt(str, 10) || 0 },
  };
}

export function tryParseBraceExpansion(
  p: Parser,
  value: string,
  start: number,
): { part: WordPart; endIndex: number } | null {
  // Find matching }
  const closeIdx = findMatchingBracket(p, value, start, "{", "}");
  if (closeIdx === -1) return null;

  const inner = value.slice(start + 1, closeIdx);

  // Check for range: {a..z} or {1..10}
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
          },
        ],
      },
      endIndex: closeIdx + 1,
    };
  }

  const charRangeMatch = inner.match(/^([a-zA-Z])\.\.([a-zA-Z])$/);
  if (charRangeMatch) {
    return {
      part: {
        type: "BraceExpansion",
        items: [
          {
            type: "Range",
            start: charRangeMatch[1],
            end: charRangeMatch[2],
          },
        ],
      },
      endIndex: closeIdx + 1,
    };
  }

  // Check for comma-separated list: {a,b,c}
  if (inner.includes(",")) {
    const items = inner.split(",").map((s) => ({
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
