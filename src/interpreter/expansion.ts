/**
 * Word Expansion
 *
 * Handles shell word expansion including:
 * - Variable expansion ($VAR, ${VAR})
 * - Command substitution $(...)
 * - Arithmetic expansion $((...))
 * - Tilde expansion (~)
 * - Brace expansion {a,b,c}
 * - Glob expansion (*, ?, [...])
 */

import type {
  ArithExpr,
  ParameterExpansionPart,
  WordNode,
  WordPart,
} from "../ast/types.js";
import { parseArithmeticExpression } from "../parser/arithmetic-parser.js";
import { Parser } from "../parser/parser.js";
import { GlobExpander } from "../shell/glob.js";
import { evaluateArithmetic, evaluateArithmeticSync } from "./arithmetic.js";
import {
  ArithmeticError,
  BadSubstitutionError,
  ExecutionLimitError,
  ExitError,
  GlobError,
} from "./errors.js";
import {
  analyzeWordParts,
  paramExpansionNeedsAsync,
  partNeedsAsync,
  wordNeedsAsync,
} from "./expansion/analysis.js";
import { expandBraceRange } from "./expansion/brace-range.js";
import { patternToRegex } from "./expansion/pattern.js";
import {
  getArrayElements,
  getVariable,
  isArray,
  isVariableSet,
} from "./expansion/variable.js";
import { smartWordSplit } from "./expansion/word-split.js";
import {
  buildIfsCharClassPattern,
  getIfs,
  getIfsSeparator,
  isIfsEmpty,
  splitByIfsForExpansion,
} from "./helpers/ifs.js";
import { getNamerefTarget, isNameref } from "./helpers/nameref.js";
import { isReadonly } from "./helpers/readonly.js";
import { escapeRegex } from "./helpers/regex.js";
import { getLiteralValue, isQuotedPart } from "./helpers/word-parts.js";
import type { InterpreterContext } from "./types.js";

// Re-export for backward compatibility
export { getArrayElements, getVariable } from "./expansion/variable.js";

/**
 * Check if a string contains glob patterns, including extglob when enabled.
 */
function hasGlobPattern(value: string, extglob: boolean): boolean {
  // Standard glob characters
  if (/[*?[]/.test(value)) {
    return true;
  }
  // Extglob patterns: @(...), *(...), +(...), ?(...), !(...)
  if (extglob && /[@*+?!]\(/.test(value)) {
    return true;
  }
  return false;
}

/**
 * Unescape backslashes in a glob pattern when glob expansion fails.
 * In bash, when a glob pattern like [\\]_ doesn't match any files,
 * the output is [\]_ (with processed escapes), not [\\]_ (raw pattern).
 */
function unescapeGlobPattern(pattern: string): string {
  let result = "";
  let i = 0;
  while (i < pattern.length) {
    if (pattern[i] === "\\" && i + 1 < pattern.length) {
      // Backslash escapes the next character - output just the escaped char
      result += pattern[i + 1];
      i += 2;
    } else {
      result += pattern[i];
      i++;
    }
  }
  return result;
}

/**
 * Quote a value for safe reuse as shell input (${var@Q} transformation)
 * Uses single quotes with proper escaping for special characters.
 */
function quoteValue(value: string): string {
  // Empty string becomes ''
  if (value === "") return "''";

  // If value contains no special characters that need $'...' format, use simple single quotes
  if (!/['\\\n\r\t\x00-\x1f\x7f]/.test(value)) {
    return `'${value}'`;
  }

  // Use $'...' format for strings with special characters
  let result = "$'";
  for (const char of value) {
    switch (char) {
      case "'":
        result += "\\'";
        break;
      case "\\":
        result += "\\\\";
        break;
      case "\n":
        result += "\\n";
        break;
      case "\r":
        result += "\\r";
        break;
      case "\t":
        result += "\\t";
        break;
      default: {
        // Check for control characters
        const code = char.charCodeAt(0);
        if (code < 32 || code === 127) {
          // Use octal escapes like bash does (not hex)
          result += `\\${code.toString(8).padStart(3, "0")}`;
        } else {
          result += char;
        }
      }
    }
  }
  return `${result}'`;
}

/**
 * Get the attributes of a variable for ${var@a} transformation.
 * Returns a string with attribute flags (e.g., "ar" for readonly array).
 *
 * Attribute flags (in order):
 * - a: indexed array
 * - A: associative array
 * - i: integer
 * - n: nameref
 * - r: readonly
 * - x: exported
 */
function getVariableAttributes(ctx: InterpreterContext, name: string): string {
  // Handle special variables (like ?, $, etc.) - they have no attributes
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    return "";
  }

  let attrs = "";

  // Check for indexed array (has numeric elements via name_0, name_1, etc. or __length marker)
  const isIndexedArray =
    ctx.state.env[`${name}__length`] !== undefined ||
    Object.keys(ctx.state.env).some(
      (k) =>
        k.startsWith(`${name}_`) && /^[0-9]+$/.test(k.slice(name.length + 1)),
    );

  // Check for associative array
  const isAssocArray = ctx.state.associativeArrays?.has(name) ?? false;

  // Add array attributes (indexed before associative)
  if (isIndexedArray && !isAssocArray) {
    attrs += "a";
  }
  if (isAssocArray) {
    attrs += "A";
  }

  // Check for integer attribute
  if (ctx.state.integerVars?.has(name)) {
    attrs += "i";
  }

  // Check for nameref attribute
  if (isNameref(ctx, name)) {
    attrs += "n";
  }

  // Check for readonly attribute
  if (isReadonly(ctx, name)) {
    attrs += "r";
  }

  // Check for exported attribute
  if (ctx.state.exportedVars?.has(name)) {
    attrs += "x";
  }

  return attrs;
}

// Helper to extract numeric value from an arithmetic expression
function _getArithValue(expr: ArithExpr): number {
  if (expr.type === "ArithNumber") {
    return expr.value;
  }
  return 0;
}

// Helper to extract literal value from a word part
function getPartValue(part: WordPart): string {
  return getLiteralValue(part) ?? "";
}

// Helper to get string value from word parts (literals only, no expansion)
function _getWordPartsValue(parts: WordPart[]): string {
  return parts.map(getPartValue).join("");
}

// Helper to fully expand word parts (including variables, arithmetic, etc.)
// inDoubleQuotes flag suppresses tilde expansion
function expandWordPartsSync(
  ctx: InterpreterContext,
  parts: WordPart[],
  inDoubleQuotes = false,
): string {
  return parts
    .map((part) => expandPartSync(ctx, part, inDoubleQuotes))
    .join("");
}

// Async version of expandWordPartsSync for parts that contain command substitution
async function expandWordPartsAsync(
  ctx: InterpreterContext,
  parts: WordPart[],
  _inDoubleQuotes = false,
): Promise<string> {
  const results: string[] = [];
  for (const part of parts) {
    results.push(await expandPart(ctx, part));
  }
  return results.join("");
}

/**
 * Check if a word is "fully quoted" - meaning glob characters should be treated literally.
 * A word is fully quoted if all its parts are either:
 * - SingleQuoted
 * - DoubleQuoted (entirely quoted variable expansion like "$pat")
 * - Escaped characters
 */
function isPartFullyQuoted(part: WordPart): boolean {
  return isQuotedPart(part);
}

/**
 * Check if an entire word is fully quoted
 */
export function isWordFullyQuoted(word: WordNode): boolean {
  // Empty word is considered quoted (matches empty pattern literally)
  if (word.parts.length === 0) return true;

  // Check if we have any unquoted parts with actual content
  for (const part of word.parts) {
    if (!isPartFullyQuoted(part)) {
      return false;
    }
  }
  return true;
}

/**
 * Escape glob metacharacters in a string for literal matching.
 * Includes extglob metacharacters: ( ) |
 */
export function escapeGlobChars(str: string): string {
  return str.replace(/([*?[\]\\()|])/g, "\\$1");
}

/**
 * Handle simple part types that don't require recursion or async.
 * Returns the expanded string, or null if the part type needs special handling.
 * inDoubleQuotes flag suppresses tilde expansion (tilde is literal inside "...")
 */
function expandSimplePart(
  ctx: InterpreterContext,
  part: WordPart,
  inDoubleQuotes = false,
): string | null {
  // Handle literal parts (Literal, SingleQuoted, Escaped)
  const literal = getLiteralValue(part);
  if (literal !== null) return literal;

  switch (part.type) {
    case "ParameterExpansion":
      return expandParameter(ctx, part, inDoubleQuotes);
    case "TildeExpansion":
      // Tilde expansion doesn't happen inside double quotes
      if (inDoubleQuotes) {
        return part.user === null ? "~" : `~${part.user}`;
      }
      if (part.user === null) {
        return ctx.state.env.HOME || "/home/user";
      }
      // ~username only expands if user exists
      // In sandboxed environment, we can only verify 'root' exists universally
      // Other unknown users stay literal (matches bash behavior)
      if (part.user === "root") {
        return "/root";
      }
      return `~${part.user}`;
    case "Glob":
      return part.pattern;
    default:
      return null; // Needs special handling (DoubleQuoted, BraceExpansion, ArithmeticExpansion, CommandSubstitution)
  }
}

// Sync version of expandPart for parts that don't need async
// inDoubleQuotes flag suppresses tilde expansion
function expandPartSync(
  ctx: InterpreterContext,
  part: WordPart,
  inDoubleQuotes = false,
): string {
  // Try simple cases first
  const simple = expandSimplePart(ctx, part, inDoubleQuotes);
  if (simple !== null) return simple;

  // Handle cases that need recursion
  switch (part.type) {
    case "DoubleQuoted": {
      const parts: string[] = [];
      for (const p of part.parts) {
        // Inside double quotes, suppress tilde expansion
        parts.push(expandPartSync(ctx, p, true));
      }
      return parts.join("");
    }

    case "ArithmeticExpansion":
      return String(evaluateArithmeticSync(ctx, part.expression.expression));

    case "BraceExpansion": {
      const results: string[] = [];
      for (const item of part.items) {
        if (item.type === "Range") {
          const range = expandBraceRange(
            item.start,
            item.end,
            item.step,
            item.startStr,
            item.endStr,
          );
          if (range.expanded) {
            results.push(...range.expanded);
          } else {
            return range.literal;
          }
        } else {
          results.push(expandWordSync(ctx, item.word));
        }
      }
      return results.join(" ");
    }

    default:
      return "";
  }
}

// Sync version of expandWord for words that don't need async
function expandWordSync(ctx: InterpreterContext, word: WordNode): string {
  const wordParts = word.parts;
  const len = wordParts.length;

  if (len === 1) {
    return expandPartSync(ctx, wordParts[0]);
  }

  const parts: string[] = [];
  for (let i = 0; i < len; i++) {
    parts.push(expandPartSync(ctx, wordParts[i]));
  }
  return parts.join("");
}

export async function expandWord(
  ctx: InterpreterContext,
  word: WordNode,
): Promise<string> {
  // Fast path: if no async parts, use sync version
  if (!wordNeedsAsync(word)) {
    return expandWordSync(ctx, word);
  }
  return expandWordAsync(ctx, word);
}

/**
 * Expand a word for use as a regex pattern (in [[ =~ ]]).
 * Preserves backslash escapes so they're passed to the regex engine.
 * For example, \[\] becomes \[\] in the regex (matching literal [ and ]).
 */
export async function expandWordForRegex(
  ctx: InterpreterContext,
  word: WordNode,
): Promise<string> {
  const parts: string[] = [];
  for (const part of word.parts) {
    if (part.type === "Escaped") {
      // For regex patterns, preserve ALL backslash escapes
      // This allows \[ \] \. \* etc. to work as regex escapes
      parts.push(`\\${part.value}`);
    } else if (part.type === "SingleQuoted") {
      // Single-quoted content is literal in regex
      parts.push(part.value);
    } else if (part.type === "DoubleQuoted") {
      // Double-quoted: expand contents
      const expanded = await expandWordPartsAsync(ctx, part.parts);
      parts.push(expanded);
    } else {
      // Other parts: expand normally
      parts.push(await expandPart(ctx, part));
    }
  }
  return parts.join("");
}

/**
 * Expand a word for use as a pattern (e.g., in [[ == ]] or case).
 * Preserves backslash escapes for pattern metacharacters so they're treated literally.
 * This prevents `*\(\)` from being interpreted as an extglob pattern.
 */
export async function expandWordForPattern(
  ctx: InterpreterContext,
  word: WordNode,
): Promise<string> {
  const parts: string[] = [];
  for (const part of word.parts) {
    if (part.type === "Escaped") {
      // For escaped characters that are pattern metacharacters, preserve the backslash
      // This includes: ( ) | * ? [ ] for glob/extglob patterns
      const ch = part.value;
      if ("()|*?[]".includes(ch)) {
        parts.push(`\\${ch}`);
      } else {
        parts.push(ch);
      }
    } else if (part.type === "SingleQuoted") {
      // Single-quoted content should be escaped for literal matching
      parts.push(escapeGlobChars(part.value));
    } else if (part.type === "DoubleQuoted") {
      // Double-quoted: expand contents and escape for literal matching
      const expanded = await expandWordPartsAsync(ctx, part.parts);
      parts.push(escapeGlobChars(expanded));
    } else {
      // Other parts: expand normally
      parts.push(await expandPart(ctx, part));
    }
  }
  return parts.join("");
}

/**
 * Expand a word for glob matching.
 * Unlike regular expansion, this escapes glob metacharacters in quoted parts
 * so they are treated as literals, while preserving glob patterns from Glob parts.
 * This enables patterns like '_tmp/[bc]'*.mm where [bc] is literal and * is a glob.
 */
async function expandWordForGlobbing(
  ctx: InterpreterContext,
  word: WordNode,
): Promise<string> {
  const parts: string[] = [];
  for (const part of word.parts) {
    if (part.type === "SingleQuoted") {
      // Single-quoted content: escape glob metacharacters for literal matching
      parts.push(escapeGlobChars(part.value));
    } else if (part.type === "Escaped") {
      // Escaped character: escape if it's a glob metacharacter
      const ch = part.value;
      if ("*?[]\\()|".includes(ch)) {
        parts.push(`\\${ch}`);
      } else {
        parts.push(ch);
      }
    } else if (part.type === "DoubleQuoted") {
      // Double-quoted: expand contents and escape glob metacharacters
      const expanded = await expandWordPartsAsync(ctx, part.parts);
      parts.push(escapeGlobChars(expanded));
    } else if (part.type === "Glob") {
      // Glob pattern: keep as-is (these are the actual patterns)
      parts.push(part.pattern);
    } else if (part.type === "Literal") {
      // Literal: keep as-is (may contain glob characters that should glob)
      parts.push(part.value);
    } else {
      // Other parts (ParameterExpansion, etc.): expand normally
      parts.push(await expandPart(ctx, part));
    }
  }
  return parts.join("");
}

/**
 * Check if word parts contain brace expansion
 */
function hasBraceExpansion(parts: WordPart[]): boolean {
  for (const part of parts) {
    if (part.type === "BraceExpansion") return true;
    if (part.type === "DoubleQuoted" && hasBraceExpansion(part.parts))
      return true;
  }
  return false;
}

/**
 * Check if brace expansion contains parts that need async (command substitution)
 */
function braceExpansionNeedsAsync(parts: WordPart[]): boolean {
  for (const part of parts) {
    if (part.type === "BraceExpansion") {
      for (const item of part.items) {
        if (item.type === "Word" && wordNeedsAsync(item.word)) {
          return true;
        }
      }
    }
    if (partNeedsAsync(part)) return true;
  }
  return false;
}

/**
 * Expand brace expansion in word parts, producing multiple string arrays.
 * Each result array represents the parts that will be joined to form one word.
 * For example, "pre{a,b}post" produces [["pre", "a", "post"], ["pre", "b", "post"]]
 */
// Maximum number of brace expansion results to prevent memory explosion
const MAX_BRACE_EXPANSION_RESULTS = 10000;
// Maximum total operations across all recursive calls
const MAX_BRACE_OPERATIONS = 100000;

function expandBracesInParts(
  ctx: InterpreterContext,
  parts: WordPart[],
  operationCounter: { count: number } = { count: 0 },
): string[][] {
  // Check global operation limit
  if (operationCounter.count > MAX_BRACE_OPERATIONS) {
    return [[]];
  }

  // Start with one empty result
  let results: string[][] = [[]];

  for (const part of parts) {
    if (part.type === "BraceExpansion") {
      // Get all brace expansion values
      const braceValues: string[] = [];
      let hasInvalidRange = false;
      let invalidRangeLiteral = "";
      for (const item of part.items) {
        if (item.type === "Range") {
          const range = expandBraceRange(
            item.start,
            item.end,
            item.step,
            item.startStr,
            item.endStr,
          );
          if (range.expanded) {
            for (const val of range.expanded) {
              operationCounter.count++;
              braceValues.push(val);
            }
          } else {
            hasInvalidRange = true;
            invalidRangeLiteral = range.literal;
            break;
          }
        } else {
          // Word item - expand it (recursively handle nested braces)
          const expanded = expandBracesInParts(
            ctx,
            item.word.parts,
            operationCounter,
          );
          for (const exp of expanded) {
            operationCounter.count++;
            braceValues.push(exp.join(""));
          }
        }
      }

      // If we have an invalid range, treat it as a literal and append to all results
      if (hasInvalidRange) {
        for (const result of results) {
          operationCounter.count++;
          result.push(invalidRangeLiteral);
        }
        continue;
      }

      // Multiply results by brace values (cartesian product)
      // But first check if this would exceed the limit
      const newSize = results.length * braceValues.length;
      if (
        newSize > MAX_BRACE_EXPANSION_RESULTS ||
        operationCounter.count > MAX_BRACE_OPERATIONS
      ) {
        // Too many results - return what we have and stop
        return results;
      }

      const newResults: string[][] = [];
      for (const result of results) {
        for (const val of braceValues) {
          operationCounter.count++;
          if (operationCounter.count > MAX_BRACE_OPERATIONS) {
            return newResults.length > 0 ? newResults : results;
          }
          newResults.push([...result, val]);
        }
      }
      results = newResults;
    } else {
      // Non-brace part: expand it and append to all results
      const expanded = expandPartSync(ctx, part);
      for (const result of results) {
        operationCounter.count++;
        result.push(expanded);
      }
    }
  }

  return results;
}

/**
 * Expand a word with brace expansion support, returning multiple values
 */
function expandWordWithBraces(
  ctx: InterpreterContext,
  word: WordNode,
): string[] {
  const parts = word.parts;

  if (!hasBraceExpansion(parts)) {
    // No brace expansion, return single value
    return [expandWordSync(ctx, word)];
  }

  // Expand braces and join each result
  const expanded = expandBracesInParts(ctx, parts);
  return expanded.map((parts) => parts.join(""));
}

/**
 * Async version of expandBracesInParts for when brace expansion contains command substitution
 */
async function expandBracesInPartsAsync(
  ctx: InterpreterContext,
  parts: WordPart[],
  operationCounter: { count: number } = { count: 0 },
): Promise<string[][]> {
  if (operationCounter.count > MAX_BRACE_OPERATIONS) {
    return [[]];
  }

  let results: string[][] = [[]];

  for (const part of parts) {
    if (part.type === "BraceExpansion") {
      const braceValues: string[] = [];
      let hasInvalidRange = false;
      let invalidRangeLiteral = "";
      for (const item of part.items) {
        if (item.type === "Range") {
          const range = expandBraceRange(
            item.start,
            item.end,
            item.step,
            item.startStr,
            item.endStr,
          );
          if (range.expanded) {
            for (const val of range.expanded) {
              operationCounter.count++;
              braceValues.push(val);
            }
          } else {
            hasInvalidRange = true;
            invalidRangeLiteral = range.literal;
            break;
          }
        } else {
          // Word item - expand it (recursively handle nested braces)
          const expanded = await expandBracesInPartsAsync(
            ctx,
            item.word.parts,
            operationCounter,
          );
          for (const exp of expanded) {
            operationCounter.count++;
            braceValues.push(exp.join(""));
          }
        }
      }

      if (hasInvalidRange) {
        for (const result of results) {
          operationCounter.count++;
          result.push(invalidRangeLiteral);
        }
        continue;
      }

      const newSize = results.length * braceValues.length;
      if (
        newSize > MAX_BRACE_EXPANSION_RESULTS ||
        operationCounter.count > MAX_BRACE_OPERATIONS
      ) {
        return results;
      }

      const newResults: string[][] = [];
      for (const result of results) {
        for (const val of braceValues) {
          operationCounter.count++;
          if (operationCounter.count > MAX_BRACE_OPERATIONS) {
            return newResults.length > 0 ? newResults : results;
          }
          newResults.push([...result, val]);
        }
      }
      results = newResults;
    } else {
      // Non-brace part: expand it asynchronously and append to all results
      const expanded = await expandPart(ctx, part);
      for (const result of results) {
        operationCounter.count++;
        result.push(expanded);
      }
    }
  }

  return results;
}

/**
 * Async version of expandWordWithBraces
 */
async function expandWordWithBracesAsync(
  ctx: InterpreterContext,
  word: WordNode,
): Promise<string[]> {
  const parts = word.parts;

  if (!hasBraceExpansion(parts)) {
    return [await expandWord(ctx, word)];
  }

  const expanded = await expandBracesInPartsAsync(ctx, parts);
  return expanded.map((parts) => parts.join(""));
}

export async function expandWordWithGlob(
  ctx: InterpreterContext,
  word: WordNode,
): Promise<{ values: string[]; quoted: boolean }> {
  const wordParts = word.parts;
  const {
    hasQuoted,
    hasCommandSub,
    hasArrayVar,
    hasArrayAtExpansion,
    hasParamExpansion,
  } = analyzeWordParts(wordParts);

  // Handle brace expansion first (produces multiple values)
  // Use async version if brace expansion contains command substitution
  const hasBraces = hasBraceExpansion(wordParts);
  const braceExpanded = hasBraces
    ? braceExpansionNeedsAsync(wordParts)
      ? await expandWordWithBracesAsync(ctx, word)
      : expandWordWithBraces(ctx, word)
    : null;

  if (braceExpanded && braceExpanded.length > 1) {
    // Brace expansion produced multiple values - apply glob to each
    const allValues: string[] = [];
    for (const value of braceExpanded) {
      // Skip glob expansion if noglob is set (set -f)
      if (
        !hasQuoted &&
        !ctx.state.options.noglob &&
        hasGlobPattern(value, ctx.state.shoptOptions.extglob)
      ) {
        const globExpander = new GlobExpander(
          ctx.fs,
          ctx.state.cwd,
          ctx.state.env,
          {
            globstar: ctx.state.shoptOptions.globstar,
            nullglob: ctx.state.shoptOptions.nullglob,
            failglob: ctx.state.shoptOptions.failglob,
            dotglob: ctx.state.shoptOptions.dotglob,
            extglob: ctx.state.shoptOptions.extglob,
          },
        );
        const matches = await globExpander.expand(value);
        if (matches.length > 0) {
          allValues.push(...matches);
        } else if (globExpander.hasFailglob()) {
          // failglob: throw error when pattern has no matches
          throw new GlobError(value);
        } else if (globExpander.hasNullglob()) {
          // nullglob: don't add anything when pattern has no matches
          // (skip adding this value)
        } else {
          // Default: keep the original pattern
          allValues.push(value);
        }
      } else {
        allValues.push(value);
      }
    }
    return { values: allValues, quoted: false };
  }

  // Special handling for "${a[@]}" - each array element becomes a separate word
  // This applies even inside double quotes
  if (
    hasArrayAtExpansion &&
    wordParts.length === 1 &&
    wordParts[0].type === "DoubleQuoted"
  ) {
    const dqPart = wordParts[0];
    // Check if it's ONLY the array expansion (like "${a[@]}")
    // More complex cases like "prefix${a[@]}suffix" need different handling
    if (
      dqPart.parts.length === 1 &&
      dqPart.parts[0].type === "ParameterExpansion"
    ) {
      const paramPart = dqPart.parts[0];
      const match = paramPart.parameter.match(
        /^([a-zA-Z_][a-zA-Z0-9_]*)\[[@]\]$/,
      );
      if (match) {
        const arrayName = match[1];
        const elements = getArrayElements(ctx, arrayName);
        if (elements.length > 0) {
          // Return each element as a separate word
          return { values: elements.map(([, v]) => v), quoted: true };
        }
        // No array elements - check for scalar variable
        // ${s[@]} where s='abc' should return 'abc' (treat scalar as single-element array)
        const scalarValue = ctx.state.env[arrayName];
        if (scalarValue !== undefined) {
          return { values: [scalarValue], quoted: true };
        }
        // Variable is unset - return empty
        return { values: [], quoted: true };
      }
    }
  }

  // Handle "$@" and "$*" with adjacent text inside double quotes, e.g., "-$@-"
  // "$@": Each positional parameter becomes a separate word, with prefix joined to first
  //       and suffix joined to last. If no params, produces nothing (or just prefix+suffix if present)
  // "$*": All params joined with IFS as ONE word. If no params, produces one empty word.
  if (wordParts.length === 1 && wordParts[0].type === "DoubleQuoted") {
    const dqPart = wordParts[0];
    // Find if there's a $@ or $* inside
    let atIndex = -1;
    let isStar = false;
    for (let i = 0; i < dqPart.parts.length; i++) {
      const p = dqPart.parts[i];
      if (
        p.type === "ParameterExpansion" &&
        (p.parameter === "@" || p.parameter === "*")
      ) {
        atIndex = i;
        isStar = p.parameter === "*";
        break;
      }
    }

    if (atIndex !== -1) {
      // Check if this is a simple $@ or $* without operations like ${*-default}
      const paramPart = dqPart.parts[atIndex];
      if (paramPart.type === "ParameterExpansion" && paramPart.operation) {
        // Has an operation - let normal expansion handle it
        atIndex = -1;
      }
    }

    if (atIndex !== -1) {
      // Get positional parameters
      const numParams = Number.parseInt(ctx.state.env["#"] || "0", 10);

      // Expand prefix (parts before $@/$*)
      let prefix = "";
      for (let i = 0; i < atIndex; i++) {
        prefix += await expandPart(ctx, dqPart.parts[i]);
      }

      // Expand suffix (parts after $@/$*)
      let suffix = "";
      for (let i = atIndex + 1; i < dqPart.parts.length; i++) {
        suffix += await expandPart(ctx, dqPart.parts[i]);
      }

      if (numParams === 0) {
        if (isStar) {
          // "$*" with no params -> one empty word (prefix + suffix)
          return { values: [prefix + suffix], quoted: true };
        }
        // "$@" with no params -> no words (unless there's prefix/suffix)
        const combined = prefix + suffix;
        return { values: combined ? [combined] : [], quoted: true };
      }

      // Get individual positional parameters
      const params: string[] = [];
      for (let i = 1; i <= numParams; i++) {
        params.push(ctx.state.env[String(i)] || "");
      }

      if (isStar) {
        // "$*" - join all params with IFS into one word
        const ifsSep = getIfsSeparator(ctx.state.env);
        return {
          values: [prefix + params.join(ifsSep) + suffix],
          quoted: true,
        };
      }

      // "$@" - each param is a separate word
      // Join prefix with first, suffix with last
      if (params.length === 1) {
        return { values: [prefix + params[0] + suffix], quoted: true };
      }

      const result = [
        prefix + params[0],
        ...params.slice(1, -1),
        params[params.length - 1] + suffix,
      ];
      return { values: result, quoted: true };
    }
  }

  // Special handling for unquoted $@ and $*
  // $@ unquoted: Each positional parameter becomes a separate word, then each is subject to IFS splitting
  // $* unquoted: All params are joined by IFS[0], then the result is split by IFS
  //
  // Key difference:
  // - $@ preserves parameter boundaries first, then splits each
  // - $* joins first, then splits (so empty params may collapse)
  if (
    wordParts.length === 1 &&
    wordParts[0].type === "ParameterExpansion" &&
    (wordParts[0].parameter === "@" || wordParts[0].parameter === "*") &&
    !wordParts[0].operation
  ) {
    const isStar = wordParts[0].parameter === "*";
    const numParams = Number.parseInt(ctx.state.env["#"] || "0", 10);
    if (numParams === 0) {
      return { values: [], quoted: false };
    }

    // Get individual positional parameters
    const params: string[] = [];
    for (let i = 1; i <= numParams; i++) {
      params.push(ctx.state.env[String(i)] || "");
    }

    const ifsChars = getIfs(ctx.state.env);
    const ifsEmpty = isIfsEmpty(ctx.state.env);

    let allWords: string[];

    if (isStar) {
      // $* - join params with IFS[0], then split result by IFS
      const ifsSep = getIfsSeparator(ctx.state.env);
      const joined = params.join(ifsSep);

      if (ifsEmpty) {
        // Empty IFS - no splitting
        allWords = joined ? [joined] : [];
      } else {
        // Split the joined string by IFS using proper splitting rules
        allWords = splitByIfsForExpansion(joined, ifsChars);
      }
    } else {
      // $@ - each param is a separate word, then each is subject to IFS splitting
      if (ifsEmpty) {
        // Empty IFS - no splitting, return params as-is
        allWords = params;
      } else {
        allWords = [];

        for (const param of params) {
          if (param === "") {
            // Empty params are preserved as empty words for $@
            allWords.push("");
          } else {
            // Split this param by IFS using proper splitting rules
            const parts = splitByIfsForExpansion(param, ifsChars);
            allWords.push(...parts);
          }
        }
      }
    }

    // Apply glob expansion to each word
    if (ctx.state.options.noglob) {
      return { values: allWords, quoted: false };
    }

    const globExpander = new GlobExpander(
      ctx.fs,
      ctx.state.cwd,
      ctx.state.env,
      {
        globstar: ctx.state.shoptOptions.globstar,
        nullglob: ctx.state.shoptOptions.nullglob,
        failglob: ctx.state.shoptOptions.failglob,
        dotglob: ctx.state.shoptOptions.dotglob,
        extglob: ctx.state.shoptOptions.extglob,
      },
    );

    const expandedValues: string[] = [];
    for (const w of allWords) {
      if (hasGlobPattern(w, ctx.state.shoptOptions.extglob)) {
        const matches = await globExpander.expand(w);
        if (matches.length > 0) {
          expandedValues.push(...matches);
        } else if (globExpander.hasFailglob()) {
          throw new GlobError(w);
        } else if (globExpander.hasNullglob()) {
          // skip
        } else {
          expandedValues.push(w);
        }
      } else {
        expandedValues.push(w);
      }
    }

    return { values: expandedValues, quoted: false };
  }

  // No brace expansion or single value - use original logic
  // Word splitting based on IFS
  // If IFS is set to empty string, no word splitting occurs
  // Word splitting applies to results of parameter expansion, command substitution, and arithmetic expansion
  // Note: hasQuoted being true does NOT prevent word splitting - unquoted expansions like $a in $a"$b"
  // should still be split. The smartWordSplit function handles this by treating quoted parts as
  // non-splittable segments that join with adjacent fields.
  if (
    (hasCommandSub || hasArrayVar || hasParamExpansion) &&
    !isIfsEmpty(ctx.state.env)
  ) {
    const ifsChars = getIfs(ctx.state.env);
    // Build regex-safe pattern from IFS characters
    const ifsPattern = buildIfsCharClassPattern(ifsChars);

    // Smart word splitting: literals should NOT be split, they attach to adjacent fields
    // E.g., ${v:-AxBxC}x with IFS=x should give "A B Cx" not "A B C"
    const splitResult = await smartWordSplit(
      ctx,
      wordParts,
      ifsChars,
      ifsPattern,
      expandPart,
    );
    // Perform glob expansion on each split value (skip if noglob is set)
    const expandedValues: string[] = [];
    if (ctx.state.options.noglob) {
      // noglob is set - skip glob expansion entirely
      return { values: splitResult, quoted: false };
    }
    const globExpander = new GlobExpander(
      ctx.fs,
      ctx.state.cwd,
      ctx.state.env,
      {
        globstar: ctx.state.shoptOptions.globstar,
        nullglob: ctx.state.shoptOptions.nullglob,
        failglob: ctx.state.shoptOptions.failglob,
        dotglob: ctx.state.shoptOptions.dotglob,
        extglob: ctx.state.shoptOptions.extglob,
      },
    );
    for (const sv of splitResult) {
      if (hasGlobPattern(sv, ctx.state.shoptOptions.extglob)) {
        const matches = await globExpander.expand(sv);
        if (matches.length > 0) {
          expandedValues.push(...matches);
        } else if (globExpander.hasFailglob()) {
          throw new GlobError(sv);
        } else if (globExpander.hasNullglob()) {
          // nullglob: skip this value
        } else {
          expandedValues.push(sv);
        }
      } else {
        expandedValues.push(sv);
      }
    }
    return { values: expandedValues, quoted: false };
  }

  const needsAsync = wordNeedsAsync(word);
  const value = needsAsync
    ? await expandWordAsync(ctx, word)
    : expandWordSync(ctx, word);

  // Check if the word contains any Glob parts
  const hasGlobParts = wordParts.some((p) => p.type === "Glob");

  // For glob expansion, we need to:
  // 1. Escape glob characters in quoted parts so they're treated as literals
  // 2. Keep glob characters from Glob parts
  // This enables patterns like '_tmp/[bc]'*.mm where [bc] is literal and * is a glob
  if (!ctx.state.options.noglob && hasGlobParts) {
    // Use expandWordForGlobbing which properly escapes quoted parts
    const globPattern = await expandWordForGlobbing(ctx, word);

    if (hasGlobPattern(globPattern, ctx.state.shoptOptions.extglob)) {
      const globExpander = new GlobExpander(
        ctx.fs,
        ctx.state.cwd,
        ctx.state.env,
        {
          globstar: ctx.state.shoptOptions.globstar,
          nullglob: ctx.state.shoptOptions.nullglob,
          failglob: ctx.state.shoptOptions.failglob,
          dotglob: ctx.state.shoptOptions.dotglob,
          extglob: ctx.state.shoptOptions.extglob,
        },
      );
      const matches = await globExpander.expand(globPattern);
      if (matches.length > 0) {
        return { values: matches, quoted: false };
      } else if (globExpander.hasFailglob()) {
        throw new GlobError(value);
      } else if (globExpander.hasNullglob()) {
        return { values: [], quoted: false };
      }
      // Glob failed - return the unescaped pattern (not the raw pattern with backslashes)
      // In bash, [\\]_ outputs [\]_ when no match, not [\\]_
      return { values: [unescapeGlobPattern(value)], quoted: false };
    }
  } else if (
    !hasQuoted &&
    !ctx.state.options.noglob &&
    hasGlobPattern(value, ctx.state.shoptOptions.extglob)
  ) {
    // No Glob parts but value contains glob characters from Literal parts
    const globExpander = new GlobExpander(
      ctx.fs,
      ctx.state.cwd,
      ctx.state.env,
      {
        globstar: ctx.state.shoptOptions.globstar,
        nullglob: ctx.state.shoptOptions.nullglob,
        failglob: ctx.state.shoptOptions.failglob,
        dotglob: ctx.state.shoptOptions.dotglob,
        extglob: ctx.state.shoptOptions.extglob,
      },
    );
    const matches = await globExpander.expand(value);
    if (matches.length > 0) {
      return { values: matches, quoted: false };
    } else if (globExpander.hasFailglob()) {
      throw new GlobError(value);
    } else if (globExpander.hasNullglob()) {
      return { values: [], quoted: false };
    }
  }

  // Empty unquoted expansion produces no words (e.g., $empty where empty is unset/empty)
  // But quoted empty string produces one empty word (e.g., "" or "$empty")
  if (value === "" && !hasQuoted) {
    return { values: [], quoted: false };
  }

  // If we have Glob parts and didn't expand (noglob or no glob pattern),
  // we still need to unescape backslashes in the value.
  // In bash, [\\]_ with set -f outputs [\]_, not [\\]_
  if (hasGlobParts && !hasQuoted) {
    return { values: [unescapeGlobPattern(value)], quoted: false };
  }

  return { values: [value], quoted: hasQuoted };
}

/**
 * Expand a redirect target with glob handling.
 *
 * For redirects:
 * - If glob matches 0 files with failglob → error (returns { error: ... })
 * - If glob matches 0 files without failglob → use literal pattern
 * - If glob matches 1 file → use that file
 * - If glob matches 2+ files → "ambiguous redirect" error
 *
 * Returns { target: string } on success or { error: string } on failure.
 */
export async function expandRedirectTarget(
  ctx: InterpreterContext,
  word: WordNode,
): Promise<{ target: string } | { error: string }> {
  const wordParts = word.parts;
  const { hasQuoted } = analyzeWordParts(wordParts);

  const needsAsync = wordNeedsAsync(word);
  const value = needsAsync
    ? await expandWordAsync(ctx, word)
    : expandWordSync(ctx, word);

  // Skip glob expansion if noglob is set (set -f) or if the word was quoted
  if (
    hasQuoted ||
    ctx.state.options.noglob ||
    !hasGlobPattern(value, ctx.state.shoptOptions.extglob)
  ) {
    return { target: value };
  }

  // Perform glob expansion for redirect targets
  const globExpander = new GlobExpander(ctx.fs, ctx.state.cwd, ctx.state.env, {
    globstar: ctx.state.shoptOptions.globstar,
    nullglob: ctx.state.shoptOptions.nullglob,
    failglob: ctx.state.shoptOptions.failglob,
    dotglob: ctx.state.shoptOptions.dotglob,
    extglob: ctx.state.shoptOptions.extglob,
  });

  const matches = await globExpander.expand(value);

  if (matches.length === 0) {
    // No matches
    if (globExpander.hasFailglob()) {
      // failglob: error on no match
      return { error: `bash: no match: ${value}\n` };
    }
    // Without failglob, use the literal pattern
    return { target: value };
  }

  if (matches.length === 1) {
    // Exactly one match - use it
    return { target: matches[0] };
  }

  // Multiple matches - ambiguous redirect error
  return { error: `bash: ${value}: ambiguous redirect\n` };
}

// Async version of expandWord (internal)
async function expandWordAsync(
  ctx: InterpreterContext,
  word: WordNode,
): Promise<string> {
  const wordParts = word.parts;
  const len = wordParts.length;

  if (len === 1) {
    return expandPart(ctx, wordParts[0]);
  }

  const parts: string[] = [];
  for (let i = 0; i < len; i++) {
    parts.push(await expandPart(ctx, wordParts[i]));
  }
  return parts.join("");
}

async function expandPart(
  ctx: InterpreterContext,
  part: WordPart,
): Promise<string> {
  // Check if ParameterExpansion needs async (has command substitution in operation)
  if (part.type === "ParameterExpansion" && paramExpansionNeedsAsync(part)) {
    return expandParameterAsync(ctx, part);
  }

  // Try simple cases first
  const simple = expandSimplePart(ctx, part);
  if (simple !== null) return simple;

  // Handle cases that need recursion or async
  switch (part.type) {
    case "DoubleQuoted": {
      const parts: string[] = [];
      for (const p of part.parts) {
        parts.push(await expandPart(ctx, p));
      }
      return parts.join("");
    }

    case "CommandSubstitution": {
      // Command substitution runs in a subshell-like context
      // ExitError should NOT terminate the main script, just this substitution
      // But ExecutionLimitError MUST propagate to protect against infinite recursion
      try {
        const result = await ctx.executeScript(part.body);
        // Store the exit code for $?
        ctx.state.lastExitCode = result.exitCode;
        ctx.state.env["?"] = String(result.exitCode);
        return result.stdout.replace(/\n+$/, "");
      } catch (error) {
        // ExecutionLimitError must always propagate - these are safety limits
        if (error instanceof ExecutionLimitError) {
          throw error;
        }
        if (error instanceof ExitError) {
          // Catch exit in command substitution - return output so far
          ctx.state.lastExitCode = error.exitCode;
          ctx.state.env["?"] = String(error.exitCode);
          return error.stdout.replace(/\n+$/, "");
        }
        throw error;
      }
    }

    case "ArithmeticExpansion":
      return String(await evaluateArithmetic(ctx, part.expression.expression));

    case "BraceExpansion": {
      const results: string[] = [];
      for (const item of part.items) {
        if (item.type === "Range") {
          const range = expandBraceRange(
            item.start,
            item.end,
            item.step,
            item.startStr,
            item.endStr,
          );
          if (range.expanded) {
            results.push(...range.expanded);
          } else {
            return range.literal;
          }
        } else {
          results.push(await expandWord(ctx, item.word));
        }
      }
      return results.join(" ");
    }

    default:
      return "";
  }
}

function expandParameter(
  ctx: InterpreterContext,
  part: ParameterExpansionPart,
  inDoubleQuotes = false,
): string {
  const { parameter, operation } = part;

  // Operations that handle unset variables should not trigger nounset
  const skipNounset =
    operation &&
    (operation.type === "DefaultValue" ||
      operation.type === "AssignDefault" ||
      operation.type === "UseAlternative" ||
      operation.type === "ErrorIfUnset");

  const value = getVariable(ctx, parameter, !skipNounset);

  if (!operation) {
    return value;
  }

  const isUnset = !isVariableSet(ctx, parameter);
  const isEmpty = value === "";

  switch (operation.type) {
    case "DefaultValue": {
      const useDefault = isUnset || (operation.checkEmpty && isEmpty);
      if (useDefault && operation.word) {
        // Only expand when actually using the default (lazy evaluation)
        // Pass inDoubleQuotes to suppress tilde expansion inside "..."
        return expandWordPartsSync(ctx, operation.word.parts, inDoubleQuotes);
      }
      return value;
    }

    case "AssignDefault": {
      const useDefault = isUnset || (operation.checkEmpty && isEmpty);
      if (useDefault && operation.word) {
        // Only expand when actually using the default (lazy evaluation)
        // Pass inDoubleQuotes to suppress tilde expansion inside "..."
        const defaultValue = expandWordPartsSync(
          ctx,
          operation.word.parts,
          inDoubleQuotes,
        );
        // Handle array subscript assignment (e.g., arr[0]=x)
        const arrayMatch = parameter.match(
          /^([a-zA-Z_][a-zA-Z0-9_]*)\[(.+)\]$/,
        );
        if (arrayMatch) {
          const [, arrayName, subscriptExpr] = arrayMatch;
          // Evaluate subscript as arithmetic expression
          let index: number;
          if (/^\d+$/.test(subscriptExpr)) {
            index = Number.parseInt(subscriptExpr, 10);
          } else {
            try {
              const parser = new Parser();
              const arithAst = parseArithmeticExpression(parser, subscriptExpr);
              index = evaluateArithmeticSync(ctx, arithAst.expression);
            } catch {
              const varValue = ctx.state.env[subscriptExpr];
              index = varValue ? Number.parseInt(varValue, 10) : 0;
            }
            if (Number.isNaN(index)) index = 0;
          }
          // Set array element
          ctx.state.env[`${arrayName}_${index}`] = defaultValue;
          // Update array length if needed
          const currentLength = Number.parseInt(
            ctx.state.env[`${arrayName}__length`] || "0",
            10,
          );
          if (index >= currentLength) {
            ctx.state.env[`${arrayName}__length`] = String(index + 1);
          }
        } else {
          ctx.state.env[parameter] = defaultValue;
        }
        return defaultValue;
      }
      return value;
    }

    case "ErrorIfUnset": {
      const shouldError = isUnset || (operation.checkEmpty && isEmpty);
      if (shouldError) {
        const message = operation.word
          ? expandWordPartsSync(ctx, operation.word.parts, inDoubleQuotes)
          : `${parameter}: parameter null or not set`;
        // Use ExitError to properly exit with status 1 and error message
        throw new ExitError(1, "", `bash: ${message}\n`);
      }
      return value;
    }

    case "UseAlternative": {
      const useAlternative = !(isUnset || (operation.checkEmpty && isEmpty));
      if (useAlternative && operation.word) {
        // Only expand when actually using the alternative (lazy evaluation)
        // Pass inDoubleQuotes to suppress tilde expansion inside "..."
        return expandWordPartsSync(ctx, operation.word.parts, inDoubleQuotes);
      }
      return "";
    }

    case "Length": {
      // Check if this is an array length: ${#a[@]} or ${#a[*]}
      const arrayMatch = parameter.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\[[@*]\]$/);
      if (arrayMatch) {
        const elements = getArrayElements(ctx, arrayMatch[1]);
        return String(elements.length);
      }
      // Check if this is just the array name (decays to ${#a[0]})
      if (
        /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(parameter) &&
        isArray(ctx, parameter)
      ) {
        const firstElement = ctx.state.env[`${parameter}_0`] || "";
        return String(firstElement.length);
      }
      return String(value.length);
    }

    case "LengthSliceError": {
      // ${#var:...} is invalid - can't take length of a substring
      throw new BadSubstitutionError(parameter);
    }

    case "Substring": {
      // Evaluate arithmetic expressions in offset and length
      const offset = operation.offset
        ? evaluateArithmeticSync(ctx, operation.offset.expression)
        : 0;
      const length = operation.length
        ? evaluateArithmeticSync(ctx, operation.length.expression)
        : undefined;

      // Handle special case for ${@:offset} and ${*:offset}
      // When offset is 0, it includes $0 (the shell name)
      if (parameter === "@" || parameter === "*") {
        const args = (ctx.state.env["@"] || "").split(" ").filter((a) => a);
        const shellName = ctx.state.env["0"] || "bash";
        // At offset 0, include $0
        const allArgs = offset === 0 ? [shellName, ...args] : args;
        const startIdx = offset === 0 ? 0 : offset - 1;
        if (startIdx < 0 || startIdx >= allArgs.length) {
          return "";
        }
        if (length !== undefined) {
          const endIdx =
            length < 0 ? allArgs.length + length : startIdx + length;
          return allArgs.slice(startIdx, Math.max(startIdx, endIdx)).join(" ");
        }
        return allArgs.slice(startIdx).join(" ");
      }

      // Handle array slicing: ${arr[@]:offset} or ${arr[*]:offset}
      const arrayMatch = parameter.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\[[@*]\]$/);
      if (arrayMatch) {
        const elements = getArrayElements(ctx, arrayMatch[1]);
        const values = elements.map(([, v]) => v);
        let start = offset;
        // Negative offset: count from end
        if (start < 0) {
          start = values.length + start;
          // Out of bounds negative index returns empty
          if (start < 0) return "";
        }
        if (length !== undefined) {
          if (length < 0) {
            // Negative length is an error for array slicing in bash
            throw new ArithmeticError(
              `${arrayMatch[1]}[@]: substring expression < 0`,
            );
          }
          return values.slice(start, start + length).join(" ");
        }
        return values.slice(start).join(" ");
      }

      // String slicing with UTF-8 support (slice by characters, not bytes)
      const chars = [...value]; // This handles multi-byte UTF-8 characters
      let start = offset;
      if (start < 0) start = Math.max(0, chars.length + start);
      if (length !== undefined) {
        if (length < 0) {
          // Negative length means end position from end
          const endPos = chars.length + length;
          return chars.slice(start, Math.max(start, endPos)).join("");
        }
        return chars.slice(start, start + length).join("");
      }
      return chars.slice(start).join("");
    }

    case "PatternRemoval": {
      // Build regex pattern from parts, preserving literal vs glob distinction
      let regexStr = "";
      if (operation.pattern) {
        for (const part of operation.pattern.parts) {
          if (part.type === "Glob") {
            // Glob pattern - convert * and ? to regex equivalents
            regexStr += patternToRegex(part.pattern, operation.greedy);
          } else if (part.type === "Literal") {
            // Unquoted literal - treat as glob pattern (may contain *, ?, [...])
            regexStr += patternToRegex(part.value, operation.greedy);
          } else if (part.type === "SingleQuoted" || part.type === "Escaped") {
            // Quoted text - escape all special regex and glob characters
            regexStr += escapeRegex(part.value);
          } else if (part.type === "DoubleQuoted") {
            // Double quoted - expand variables but treat result as literal
            const expanded = expandWordPartsSync(ctx, part.parts);
            regexStr += escapeRegex(expanded);
          } else if (part.type === "ParameterExpansion") {
            // Unquoted parameter expansion - treat expanded value as glob pattern
            const expanded = expandPartSync(ctx, part);
            regexStr += patternToRegex(expanded, operation.greedy);
          } else {
            // Other parts - expand and escape (command substitution, etc.)
            const expanded = expandPartSync(ctx, part);
            regexStr += escapeRegex(expanded);
          }
        }
      }

      if (operation.side === "prefix") {
        // Prefix removal: greedy matches longest from start, non-greedy matches shortest
        return value.replace(new RegExp(`^${regexStr}`), "");
      }
      // Suffix removal needs special handling because we need to find
      // the rightmost (shortest) or leftmost (longest) match
      const regex = new RegExp(`${regexStr}$`);
      if (operation.greedy) {
        // %% - longest match: use regex directly (finds leftmost match)
        return value.replace(regex, "");
      }
      // % - shortest match: find rightmost position where pattern matches to end
      for (let i = value.length; i >= 0; i--) {
        const suffix = value.slice(i);
        if (regex.test(suffix)) {
          return value.slice(0, i);
        }
      }
      return value;
    }

    case "PatternReplacement": {
      // Build regex pattern from parts, preserving literal vs glob distinction
      let regex = "";
      if (operation.pattern) {
        for (const part of operation.pattern.parts) {
          if (part.type === "Glob") {
            // Glob pattern - convert * and ? to regex equivalents
            regex += patternToRegex(part.pattern, true);
          } else if (part.type === "Literal") {
            // Unquoted literal - treat as glob pattern (may contain *, ?, [...], \X)
            regex += patternToRegex(part.value, true);
          } else if (part.type === "SingleQuoted" || part.type === "Escaped") {
            // Quoted text - escape all special regex and glob characters
            regex += escapeRegex(part.value);
          } else if (part.type === "DoubleQuoted") {
            // Double quoted - expand variables but treat result as literal
            const expanded = expandWordPartsSync(ctx, part.parts);
            regex += escapeRegex(expanded);
          } else if (part.type === "ParameterExpansion") {
            // Unquoted parameter expansion - treat expanded value as glob pattern
            // In bash, ${v//$pat/x} where pat='*' treats * as a glob
            const expanded = expandPartSync(ctx, part);
            regex += patternToRegex(expanded, true);
          } else {
            // Other parts - expand and escape (command substitution, etc.)
            const expanded = expandPartSync(ctx, part);
            regex += escapeRegex(expanded);
          }
        }
      }

      const replacement = operation.replacement
        ? expandWordPartsSync(ctx, operation.replacement.parts)
        : "";

      // Empty pattern means no replacement - return original value
      // This prevents infinite loops and matches bash behavior
      if (regex === "") {
        return value;
      }

      // Apply anchor modifiers
      if (operation.anchor === "start") {
        regex = `^${regex}`;
      } else if (operation.anchor === "end") {
        regex = `${regex}$`;
      }
      const flags = operation.all ? "g" : "";

      // Handle invalid regex patterns (like [z-a] which is an invalid range)
      // Bash just returns the original value when pattern doesn't match
      try {
        const re = new RegExp(regex, flags);
        if (operation.all) {
          // For global replace, avoid matching empty string at end which
          // JavaScript regex does but bash pattern matching doesn't
          let result = "";
          let lastIndex = 0;
          let match: RegExpExecArray | null = re.exec(value);
          while (match !== null) {
            // Skip empty matches (except at the start when pattern allows)
            if (match[0].length === 0 && match.index === value.length) {
              break;
            }
            result += value.slice(lastIndex, match.index) + replacement;
            lastIndex = match.index + match[0].length;
            // Prevent infinite loop on zero-length matches
            if (match[0].length === 0) {
              lastIndex++;
            }
            match = re.exec(value);
          }
          result += value.slice(lastIndex);
          return result;
        }
        return value.replace(re, replacement);
      } catch {
        // Invalid regex - return original value like bash does
        return value;
      }
    }

    case "CaseModification": {
      if (operation.direction === "upper") {
        return operation.all
          ? value.toUpperCase()
          : value.charAt(0).toUpperCase() + value.slice(1);
      }
      return operation.all
        ? value.toLowerCase()
        : value.charAt(0).toLowerCase() + value.slice(1);
    }

    case "Transform": {
      // Handle array transformations specially
      const arrayMatch = parameter.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\[[@*]\]$/);
      if (arrayMatch && operation.operator === "Q") {
        // ${arr[@]@Q} - quote each element
        const elements = getArrayElements(ctx, arrayMatch[1]);
        const quotedElements = elements.map(([, v]) => quoteValue(v));
        return quotedElements.join(" ");
      }
      if (arrayMatch && operation.operator === "a") {
        // ${arr[@]@a} - return attributes of array
        return getVariableAttributes(ctx, arrayMatch[1]);
      }

      // Handle array element references like ${arr[0]@a}
      const arrayElemMatch = parameter.match(
        /^([a-zA-Z_][a-zA-Z0-9_]*)\[.+\]$/,
      );
      if (arrayElemMatch && operation.operator === "a") {
        // ${arr[0]@a} - return attributes of the array itself
        return getVariableAttributes(ctx, arrayElemMatch[1]);
      }

      switch (operation.operator) {
        case "Q":
          // Quote the value for reuse as shell input
          return quoteValue(value);
        case "P":
          // Expand as if it were a prompt string (limited implementation)
          return value;
        case "a":
          // Return attribute flags for the variable
          return getVariableAttributes(ctx, parameter);
        case "A":
          // Assignment format: name='value'
          return `${parameter}=${quoteValue(value)}`;
        case "E":
          // Expand escape sequences
          return value.replace(/\\([\\abefnrtv'"?])/g, (_, c) => {
            switch (c) {
              case "\\":
                return "\\";
              case "a":
                return "\x07";
              case "b":
                return "\b";
              case "e":
                return "\x1b";
              case "f":
                return "\f";
              case "n":
                return "\n";
              case "r":
                return "\r";
              case "t":
                return "\t";
              case "v":
                return "\v";
              case "'":
                return "'";
              case '"':
                return '"';
              case "?":
                return "?";
              default:
                return c;
            }
          });
        case "K":
          // Return keys (same as ${!arr[@]} for arrays)
          return "";
        default:
          return value;
      }
    }

    case "Indirection": {
      // For namerefs, ${!ref} returns the name of the target variable (inverted behavior)
      // For regular variables, ${!ref} returns the value of the variable named by $ref
      if (isNameref(ctx, parameter)) {
        // Return the target name, not the value
        return getNamerefTarget(ctx, parameter) || "";
      }

      // value contains the name of the parameter, get the target variable name
      const targetName = value;

      // If there's an inner operation (e.g., ${!ref-default}), apply it
      if (operation.innerOp) {
        // Create a synthetic part to recursively expand with the inner operation
        const syntheticPart: ParameterExpansionPart = {
          type: "ParameterExpansion",
          parameter: targetName,
          operation: operation.innerOp,
        };
        return expandParameter(ctx, syntheticPart, inDoubleQuotes);
      }

      return getVariable(ctx, targetName);
    }

    case "ArrayKeys": {
      // ${!arr[@]} or ${!arr[*]} - return the keys/indices of an array
      const elements = getArrayElements(ctx, operation.array);
      const keys = elements.map(([k]) => String(k));
      if (operation.star) {
        // ${!arr[*]} - join with first char of IFS
        return keys.join(getIfsSeparator(ctx.state.env));
      }
      // ${!arr[@]} - join with space
      return keys.join(" ");
    }

    case "VarNamePrefix": {
      // ${!prefix*} or ${!prefix@} - list variable names with prefix
      const matchingVars = Object.keys(ctx.state.env)
        .filter(
          (k) =>
            k.startsWith(operation.prefix) &&
            // Exclude internal array storage keys (contain _ after the prefix)
            !k.includes("__"),
        )
        .sort();
      if (operation.star) {
        // ${!prefix*} - join with first char of IFS
        return matchingVars.join(getIfsSeparator(ctx.state.env));
      }
      // ${!prefix@} - join with space
      return matchingVars.join(" ");
    }

    default:
      return value;
  }
}

// Async version of expandParameter for parameter expansions that contain command substitution
async function expandParameterAsync(
  ctx: InterpreterContext,
  part: ParameterExpansionPart,
  inDoubleQuotes = false,
): Promise<string> {
  const { parameter, operation } = part;

  // Operations that handle unset variables should not trigger nounset
  const skipNounset =
    operation &&
    (operation.type === "DefaultValue" ||
      operation.type === "AssignDefault" ||
      operation.type === "UseAlternative" ||
      operation.type === "ErrorIfUnset");

  const value = getVariable(ctx, parameter, !skipNounset);

  if (!operation) {
    return value;
  }

  const isUnset = !isVariableSet(ctx, parameter);
  const isEmpty = value === "";

  switch (operation.type) {
    case "DefaultValue": {
      const useDefault = isUnset || (operation.checkEmpty && isEmpty);
      if (useDefault && operation.word) {
        return expandWordPartsAsync(ctx, operation.word.parts, inDoubleQuotes);
      }
      return value;
    }

    case "AssignDefault": {
      const useDefault = isUnset || (operation.checkEmpty && isEmpty);
      if (useDefault && operation.word) {
        const defaultValue = await expandWordPartsAsync(
          ctx,
          operation.word.parts,
          inDoubleQuotes,
        );
        // Handle array subscript assignment (e.g., arr[0]=x)
        const arrayMatch = parameter.match(
          /^([a-zA-Z_][a-zA-Z0-9_]*)\[(.+)\]$/,
        );
        if (arrayMatch) {
          const [, arrayName, subscriptExpr] = arrayMatch;
          // Evaluate subscript as arithmetic expression
          let index: number;
          if (/^\d+$/.test(subscriptExpr)) {
            index = Number.parseInt(subscriptExpr, 10);
          } else {
            try {
              const parser = new Parser();
              const arithAst = parseArithmeticExpression(parser, subscriptExpr);
              index = await evaluateArithmetic(ctx, arithAst.expression);
            } catch {
              const varValue = ctx.state.env[subscriptExpr];
              index = varValue ? Number.parseInt(varValue, 10) : 0;
            }
            if (Number.isNaN(index)) index = 0;
          }
          // Set array element
          ctx.state.env[`${arrayName}_${index}`] = defaultValue;
          // Update array length if needed
          const currentLength = Number.parseInt(
            ctx.state.env[`${arrayName}__length`] || "0",
            10,
          );
          if (index >= currentLength) {
            ctx.state.env[`${arrayName}__length`] = String(index + 1);
          }
        } else {
          ctx.state.env[parameter] = defaultValue;
        }
        return defaultValue;
      }
      return value;
    }

    case "ErrorIfUnset": {
      const shouldError = isUnset || (operation.checkEmpty && isEmpty);
      if (shouldError) {
        const message = operation.word
          ? await expandWordPartsAsync(
              ctx,
              operation.word.parts,
              inDoubleQuotes,
            )
          : `${parameter}: parameter null or not set`;
        throw new ExitError(1, "", `bash: ${message}\n`);
      }
      return value;
    }

    case "UseAlternative": {
      const useAlternative = !(isUnset || (operation.checkEmpty && isEmpty));
      if (useAlternative && operation.word) {
        return expandWordPartsAsync(ctx, operation.word.parts, inDoubleQuotes);
      }
      return "";
    }

    case "PatternRemoval": {
      // Build regex pattern from parts, preserving literal vs glob distinction
      let regexStr = "";
      if (operation.pattern) {
        for (const part of operation.pattern.parts) {
          if (part.type === "Glob") {
            regexStr += patternToRegex(part.pattern, operation.greedy);
          } else if (part.type === "Literal") {
            // Unquoted literal - treat as glob pattern (may contain *, ?, [...])
            regexStr += patternToRegex(part.value, operation.greedy);
          } else if (part.type === "SingleQuoted" || part.type === "Escaped") {
            regexStr += escapeRegex(part.value);
          } else if (part.type === "DoubleQuoted") {
            const expanded = await expandWordPartsAsync(ctx, part.parts);
            regexStr += escapeRegex(expanded);
          } else if (part.type === "ParameterExpansion") {
            const expanded = await expandPart(ctx, part);
            regexStr += patternToRegex(expanded, operation.greedy);
          } else {
            const expanded = await expandPart(ctx, part);
            regexStr += escapeRegex(expanded);
          }
        }
      }

      if (operation.side === "prefix") {
        return value.replace(new RegExp(`^${regexStr}`), "");
      }
      const regex = new RegExp(`${regexStr}$`);
      if (operation.greedy) {
        return value.replace(regex, "");
      }
      for (let i = value.length; i >= 0; i--) {
        const suffix = value.slice(i);
        if (regex.test(suffix)) {
          return value.slice(0, i);
        }
      }
      return value;
    }

    case "PatternReplacement": {
      let regex = "";
      if (operation.pattern) {
        for (const part of operation.pattern.parts) {
          if (part.type === "Glob") {
            regex += patternToRegex(part.pattern, true);
          } else if (part.type === "Literal") {
            // Unquoted literal - treat as glob pattern (may contain *, ?, [...], \X)
            regex += patternToRegex(part.value, true);
          } else if (part.type === "SingleQuoted" || part.type === "Escaped") {
            regex += escapeRegex(part.value);
          } else if (part.type === "DoubleQuoted") {
            const expanded = await expandWordPartsAsync(ctx, part.parts);
            regex += escapeRegex(expanded);
          } else if (part.type === "ParameterExpansion") {
            const expanded = await expandPart(ctx, part);
            regex += patternToRegex(expanded, true);
          } else {
            const expanded = await expandPart(ctx, part);
            regex += escapeRegex(expanded);
          }
        }
      }

      const replacement = operation.replacement
        ? await expandWordPartsAsync(ctx, operation.replacement.parts)
        : "";

      if (regex === "") {
        return value;
      }

      if (operation.anchor === "start") {
        regex = `^${regex}`;
      } else if (operation.anchor === "end") {
        regex = `${regex}$`;
      }
      const flags = operation.all ? "g" : "";

      try {
        const re = new RegExp(regex, flags);
        if (operation.all) {
          let result = "";
          let lastIndex = 0;
          let match: RegExpExecArray | null = re.exec(value);
          while (match !== null) {
            if (match[0].length === 0 && match.index === value.length) {
              break;
            }
            result += value.slice(lastIndex, match.index) + replacement;
            lastIndex = match.index + match[0].length;
            if (match[0].length === 0) {
              lastIndex++;
            }
            match = re.exec(value);
          }
          result += value.slice(lastIndex);
          return result;
        }
        return value.replace(re, replacement);
      } catch {
        return value;
      }
    }

    // Other operations don't have words with command substitution, use sync
    default:
      return expandParameter(ctx, part, inDoubleQuotes);
  }
}
