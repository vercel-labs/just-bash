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
import { GlobExpander } from "../shell/glob.js";
import { evaluateArithmetic, evaluateArithmeticSync } from "./arithmetic.js";
import { BadSubstitutionError, ExitError, NounsetError } from "./errors.js";
import { getArrayIndices } from "./helpers/array.js";
import { escapeRegex } from "./helpers/regex.js";
import { getLiteralValue, isQuotedPart } from "./helpers/word-parts.js";
import type { InterpreterContext } from "./types.js";

// Helper to extract numeric value from an arithmetic expression
function getArithValue(expr: ArithExpr): number {
  if (expr.type === "ArithNumber") {
    return expr.value;
  }
  return 0;
}

// Maximum iterations for range expansion to prevent infinite loops
const MAX_SAFE_RANGE_ITERATIONS = 10000;

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
): string[] | null {
  // Step of 0 is treated as 1 in bash
  let step = rawStep ?? 1;
  if (step === 0) step = 1;

  // Use absolute value of step - bash ignores step sign and uses natural direction
  const absStep = Math.abs(step);

  const results: string[] = [];

  // Determine zero-padding width (max width of start or end if leading zeros)
  let padWidth = 0;
  if (startStr && startStr.match(/^-?0\d/)) {
    padWidth = Math.max(padWidth, startStr.replace(/^-/, "").length);
  }
  if (endStr && endStr.match(/^-?0\d/)) {
    padWidth = Math.max(padWidth, endStr.replace(/^-/, "").length);
  }

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
      results.push(formatNum(i));
    }
  } else {
    // Descending range (start > end)
    for (
      let i = start, count = 0;
      i >= end && count < MAX_SAFE_RANGE_ITERATIONS;
      i -= absStep, count++
    ) {
      results.push(formatNum(i));
    }
  }

  return results;
}

/**
 * Safely expand a character range with step, preventing infinite loops.
 * Returns array of string values, or null if the range is invalid.
 *
 * Bash behavior:
 * - When step is 0, treat it as 1
 * - When step direction is "wrong", use absolute value and go in natural direction
 * - Mixed case (e.g., {z..A}) is invalid - return null
 */
function safeExpandCharRange(
  start: string,
  end: string,
  rawStep: number | undefined,
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
    return null; // Mixed case is invalid
  }

  const results: string[] = [];

  if (startCode <= endCode) {
    // Ascending range
    for (
      let i = startCode, count = 0;
      i <= endCode && count < MAX_SAFE_RANGE_ITERATIONS;
      i += absStep, count++
    ) {
      results.push(String.fromCharCode(i));
    }
  } else {
    // Descending range
    for (
      let i = startCode, count = 0;
      i >= endCode && count < MAX_SAFE_RANGE_ITERATIONS;
      i -= absStep, count++
    ) {
      results.push(String.fromCharCode(i));
    }
  }

  return results;
}

/**
 * Result of a brace range expansion.
 * Either contains expanded values or a literal fallback for invalid ranges.
 */
interface BraceRangeResult {
  expanded: string[] | null;
  literal: string;
}

/**
 * Unified brace range expansion helper.
 * Handles both numeric and character ranges, returning either expanded values
 * or a literal string for invalid ranges.
 */
function expandBraceRange(
  start: number | string,
  end: number | string,
  step: number | undefined,
  startStr?: string,
  endStr?: string,
): BraceRangeResult {
  const stepPart = step !== undefined ? `..${step}` : "";

  if (typeof start === "number" && typeof end === "number") {
    const expanded = safeExpandNumericRange(start, end, step, startStr, endStr);
    return {
      expanded,
      literal: `{${start}..${end}${stepPart}}`,
    };
  }

  if (typeof start === "string" && typeof end === "string") {
    const expanded = safeExpandCharRange(start, end, step);
    return {
      expanded,
      literal: `{${start}..${end}${stepPart}}`,
    };
  }

  // Mixed types - invalid
  return {
    expanded: null,
    literal: `{${start}..${end}${stepPart}}`,
  };
}

// Helper to extract literal value from a word part
function getPartValue(part: WordPart): string {
  return getLiteralValue(part) ?? "";
}

// Helper to get string value from word parts (literals only, no expansion)
function getWordPartsValue(parts: WordPart[]): string {
  return parts.map(getPartValue).join("");
}

// Helper to fully expand word parts (including variables, arithmetic, etc.)
function expandWordPartsSync(
  ctx: InterpreterContext,
  parts: WordPart[],
): string {
  return parts.map((part) => expandPartSync(ctx, part)).join("");
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
 * Escape glob metacharacters in a string for literal matching
 */
export function escapeGlobChars(str: string): string {
  return str.replace(/([*?[\]\\])/g, "\\$1");
}

// Check if a word part requires async execution
function arithExprNeedsAsync(
  expr: import("../ast/types.js").ArithExpr,
): boolean {
  switch (expr.type) {
    case "ArithCommandSubst":
      return true;
    case "ArithNested":
      return arithExprNeedsAsync(expr.expression);
    case "ArithBinary":
      return arithExprNeedsAsync(expr.left) || arithExprNeedsAsync(expr.right);
    case "ArithUnary":
      return arithExprNeedsAsync(expr.operand);
    case "ArithTernary":
      return (
        arithExprNeedsAsync(expr.condition) ||
        arithExprNeedsAsync(expr.consequent) ||
        arithExprNeedsAsync(expr.alternate)
      );
    case "ArithAssignment":
      return arithExprNeedsAsync(expr.value);
    case "ArithGroup":
      return arithExprNeedsAsync(expr.expression);
    case "ArithArrayElement":
      return arithExprNeedsAsync(expr.index);
    default:
      return false;
  }
}

function partNeedsAsync(part: WordPart): boolean {
  switch (part.type) {
    case "CommandSubstitution":
      return true;
    case "ArithmeticExpansion":
      return arithExprNeedsAsync(part.expression.expression);
    case "DoubleQuoted":
      return part.parts.some(partNeedsAsync);
    case "BraceExpansion":
      return part.items.some(
        (item) => item.type === "Word" && wordNeedsAsync(item.word),
      );
    default:
      return false;
  }
}

// Check if a word requires async execution
function wordNeedsAsync(word: WordNode): boolean {
  return word.parts.some(partNeedsAsync);
}

/**
 * Handle simple part types that don't require recursion or async.
 * Returns the expanded string, or null if the part type needs special handling.
 */
function expandSimplePart(ctx: InterpreterContext, part: WordPart): string | null {
  // Handle literal parts (Literal, SingleQuoted, Escaped)
  const literal = getLiteralValue(part);
  if (literal !== null) return literal;

  switch (part.type) {
    case "ParameterExpansion":
      return expandParameter(ctx, part);
    case "TildeExpansion":
      if (part.user === null) {
        return ctx.state.env.HOME || "/home/user";
      }
      return `~${part.user}`;
    case "Glob":
      return part.pattern;
    default:
      return null; // Needs special handling (DoubleQuoted, BraceExpansion, ArithmeticExpansion, CommandSubstitution)
  }
}

// Sync version of expandPart for parts that don't need async
function expandPartSync(ctx: InterpreterContext, part: WordPart): string {
  // Try simple cases first
  const simple = expandSimplePart(ctx, part);
  if (simple !== null) return simple;

  // Handle cases that need recursion
  switch (part.type) {
    case "DoubleQuoted": {
      const parts: string[] = [];
      for (const p of part.parts) {
        parts.push(expandPartSync(ctx, p));
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

// Analyze word parts for expansion behavior
function analyzeWordParts(parts: WordPart[]): {
  hasQuoted: boolean;
  hasCommandSub: boolean;
  hasArrayVar: boolean;
  hasArrayAtExpansion: boolean;
} {
  let hasQuoted = false;
  let hasCommandSub = false;
  let hasArrayVar = false;
  let hasArrayAtExpansion = false;

  for (const part of parts) {
    if (part.type === "SingleQuoted" || part.type === "DoubleQuoted") {
      hasQuoted = true;
      // Check for "${a[@]}" inside double quotes
      // BUT NOT if there's an operation like ${#a[@]} (Length) or other operations
      if (part.type === "DoubleQuoted") {
        for (const inner of part.parts) {
          if (inner.type === "ParameterExpansion") {
            // Check if it's array[@] or array[*] WITHOUT any operation
            const match = inner.parameter.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\[[@*]\]$/);
            if (match && !inner.operation) {
              hasArrayAtExpansion = true;
            }
          }
        }
      }
    }
    if (part.type === "CommandSubstitution") {
      hasCommandSub = true;
    }
    if (
      part.type === "ParameterExpansion" &&
      (part.parameter === "@" || part.parameter === "*")
    ) {
      hasArrayVar = true;
    }
  }

  return { hasQuoted, hasCommandSub, hasArrayVar, hasArrayAtExpansion };
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

export async function expandWordWithGlob(
  ctx: InterpreterContext,
  word: WordNode,
): Promise<{ values: string[]; quoted: boolean }> {
  const wordParts = word.parts;
  const { hasQuoted, hasCommandSub, hasArrayVar, hasArrayAtExpansion } = analyzeWordParts(wordParts);

  // Handle brace expansion first (produces multiple values)
  const braceExpanded = hasBraceExpansion(wordParts)
    ? expandWordWithBraces(ctx, word)
    : null;

  if (braceExpanded && braceExpanded.length > 1) {
    // Brace expansion produced multiple values - apply glob to each
    const allValues: string[] = [];
    for (const value of braceExpanded) {
      if (!hasQuoted && /[*?[]/.test(value)) {
        const globExpander = new GlobExpander(ctx.fs, ctx.state.cwd);
        const matches = await globExpander.expand(value);
        if (matches.length > 0) {
          allValues.push(...matches);
        } else {
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
  if (hasArrayAtExpansion && wordParts.length === 1 && wordParts[0].type === "DoubleQuoted") {
    const dqPart = wordParts[0];
    // Check if it's ONLY the array expansion (like "${a[@]}")
    // More complex cases like "prefix${a[@]}suffix" need different handling
    if (dqPart.parts.length === 1 && dqPart.parts[0].type === "ParameterExpansion") {
      const paramPart = dqPart.parts[0];
      const match = paramPart.parameter.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\[[@]\]$/);
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

  // No brace expansion or single value - use original logic
  const needsAsync = wordNeedsAsync(word);
  const value = needsAsync
    ? await expandWordAsync(ctx, word)
    : expandWordSync(ctx, word);

  // Word splitting: check for any IFS whitespace (space, tab, newline)
  if (!hasQuoted && (hasCommandSub || hasArrayVar) && /\s/.test(value)) {
    const splitValues = value.split(/\s+/).filter((v) => v !== "");
    if (splitValues.length > 1) {
      return { values: splitValues, quoted: false };
    }
  }

  if (!hasQuoted && /[*?[]/.test(value)) {
    const globExpander = new GlobExpander(ctx.fs, ctx.state.cwd);
    const matches = await globExpander.expand(value);
    if (matches.length > 0) {
      return { values: matches, quoted: false };
    }
  }

  return { values: [value], quoted: hasQuoted };
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
      const result = await ctx.executeScript(part.body);
      return result.stdout.replace(/\n+$/, "");
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

  const isUnset = !(parameter in ctx.state.env);
  const isEmpty = value === "";

  switch (operation.type) {
    case "DefaultValue": {
      const useDefault = isUnset || (operation.checkEmpty && isEmpty);
      if (useDefault && operation.word) {
        // Only expand when actually using the default (lazy evaluation)
        return expandWordPartsSync(ctx, operation.word.parts);
      }
      return value;
    }

    case "AssignDefault": {
      const useDefault = isUnset || (operation.checkEmpty && isEmpty);
      if (useDefault && operation.word) {
        // Only expand when actually using the default (lazy evaluation)
        const defaultValue = expandWordPartsSync(ctx, operation.word.parts);
        ctx.state.env[parameter] = defaultValue;
        return defaultValue;
      }
      return value;
    }

    case "ErrorIfUnset": {
      const shouldError = isUnset || (operation.checkEmpty && isEmpty);
      if (shouldError) {
        const message = operation.word
          ? expandWordPartsSync(ctx, operation.word.parts)
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
        return expandWordPartsSync(ctx, operation.word.parts);
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
      // Expand the pattern (for variable expansion in patterns like ${var#$prefix})
      const pattern = operation.pattern
        ? expandWordPartsSync(ctx, operation.pattern.parts)
        : "";
      if (operation.side === "prefix") {
        // Prefix removal: greedy matches longest from start, non-greedy matches shortest
        const regex = patternToRegex(pattern, operation.greedy);
        return value.replace(new RegExp(`^${regex}`), "");
      }
      // Suffix removal needs special handling because we need to find
      // the rightmost (shortest) or leftmost (longest) match
      const regex = new RegExp(`${patternToRegex(pattern, true)}$`);
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
          } else if (
            part.type === "Literal" ||
            part.type === "SingleQuoted" ||
            part.type === "Escaped"
          ) {
            // Literal text - escape all special regex and glob characters
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
        regex = "^" + regex;
      } else if (operation.anchor === "end") {
        regex = regex + "$";
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
          let match: RegExpExecArray | null;
          while ((match = re.exec(value)) !== null) {
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

    case "Indirection": {
      return getVariable(ctx, value);
    }

    default:
      return value;
  }
}

/**
 * Get all elements of an array stored as arrayName_0, arrayName_1, etc.
 * Returns an array of [index, value] tuples, sorted by index.
 */
export function getArrayElements(
  ctx: InterpreterContext,
  arrayName: string,
): Array<[number, string]> {
  const indices = getArrayIndices(ctx, arrayName);
  return indices.map((index) => [index, ctx.state.env[`${arrayName}_${index}`]]);
}

/**
 * Check if a variable is an array (has elements stored as name_0, name_1, etc.)
 */
export function isArray(ctx: InterpreterContext, name: string): boolean {
  return getArrayIndices(ctx, name).length > 0;
}

/**
 * Get the value of a variable, optionally checking nounset.
 * @param ctx - The interpreter context
 * @param name - The variable name
 * @param checkNounset - Whether to check for nounset (default true)
 */
export function getVariable(
  ctx: InterpreterContext,
  name: string,
  checkNounset = true,
): string {
  // Special variables are always defined (never trigger nounset)
  switch (name) {
    case "?":
      return String(ctx.state.lastExitCode);
    case "$":
      return String(process.pid);
    case "#":
      return ctx.state.env["#"] || "0";
    case "@":
    case "*":
      return ctx.state.env["@"] || "";
    case "0":
      return ctx.state.env["0"] || "bash";
    case "PWD":
      // Check if PWD is in env (might have been unset)
      if (ctx.state.env.PWD !== undefined) {
        return ctx.state.env.PWD;
      }
      // PWD was unset, return empty string
      return "";
    case "OLDPWD":
      // Check if OLDPWD is in env (might have been unset)
      if (ctx.state.env.OLDPWD !== undefined) {
        return ctx.state.env.OLDPWD;
      }
      return "";
  }

  // Check for array subscript: varName[subscript]
  const bracketMatch = name.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\[(.+)\]$/);
  if (bracketMatch) {
    const arrayName = bracketMatch[1];
    const subscript = bracketMatch[2];

    if (subscript === "@" || subscript === "*") {
      // Get all array elements joined with space
      const elements = getArrayElements(ctx, arrayName);
      if (elements.length > 0) {
        return elements.map(([, v]) => v).join(" ");
      }
      // If no array elements, treat scalar variable as single-element array
      // ${s[@]} where s='abc' returns 'abc'
      const scalarValue = ctx.state.env[arrayName];
      if (scalarValue !== undefined) {
        return scalarValue;
      }
      return "";
    }

    // Numeric subscript - evaluate it as arithmetic
    let index: number;
    if (/^-?\d+$/.test(subscript)) {
      index = Number.parseInt(subscript, 10);
    } else {
      // Subscript may be a variable or arithmetic expression
      const evalValue = ctx.state.env[subscript];
      index = evalValue ? Number.parseInt(evalValue, 10) : 0;
      if (Number.isNaN(index)) index = 0;
    }

    // Handle negative indices
    if (index < 0) {
      const elements = getArrayElements(ctx, arrayName);
      const len = elements.length;
      if (len === 0) return "";
      // Negative index counts from end
      const actualIdx = len + index;
      if (actualIdx < 0) return "";
      // Find element at that position in the sorted array
      if (actualIdx < elements.length) {
        return elements[actualIdx][1];
      }
      return "";
    }

    const value = ctx.state.env[`${arrayName}_${index}`];
    if (value === undefined && checkNounset && ctx.state.options.nounset) {
      throw new NounsetError(`${arrayName}[${index}]`);
    }
    return value || "";
  }

  // Positional parameters ($1, $2, etc.) - check nounset
  if (/^[1-9][0-9]*$/.test(name)) {
    const value = ctx.state.env[name];
    if (value === undefined && checkNounset && ctx.state.options.nounset) {
      throw new NounsetError(name);
    }
    return value || "";
  }

  // Regular variables - check nounset
  const value = ctx.state.env[name];
  if (value === undefined && checkNounset && ctx.state.options.nounset) {
    throw new NounsetError(name);
  }
  return value || "";
}

export function patternToRegex(pattern: string, greedy: boolean): string {
  let regex = "";
  let i = 0;

  while (i < pattern.length) {
    const char = pattern[i];

    if (char === "*") {
      regex += greedy ? ".*" : ".*?";
      i++;
    } else if (char === "?") {
      regex += ".";
      i++;
    } else if (char === "[") {
      // Character class - find the matching ]
      const classEnd = findCharClassEnd(pattern, i);
      if (classEnd === -1) {
        // No matching ], escape the [
        regex += "\\[";
        i++;
      } else {
        // Extract and convert the character class
        const classContent = pattern.slice(i + 1, classEnd);
        regex += convertCharClass(classContent);
        i = classEnd + 1;
      }
    } else if (/[\\^$.|+(){}]/.test(char)) {
      // Escape regex special chars (but NOT [ and ] - handled above)
      regex += `\\${char}`;
      i++;
    } else {
      regex += char;
      i++;
    }
  }
  return regex;
}

/**
 * Find the end of a character class starting at position i (where pattern[i] is '[')
 */
function findCharClassEnd(pattern: string, start: number): number {
  let i = start + 1;

  // Handle negation
  if (i < pattern.length && pattern[i] === "^") {
    i++;
  }

  // A ] immediately after [ or [^ is literal, not closing
  if (i < pattern.length && pattern[i] === "]") {
    i++;
  }

  while (i < pattern.length) {
    if (pattern[i] === "]") {
      return i;
    }

    // Handle single quotes inside character class (bash extension)
    if (pattern[i] === "'") {
      const closeQuote = pattern.indexOf("'", i + 1);
      if (closeQuote !== -1) {
        i = closeQuote + 1;
        continue;
      }
    }

    // Handle POSIX classes [:name:]
    if (
      pattern[i] === "[" &&
      i + 1 < pattern.length &&
      pattern[i + 1] === ":"
    ) {
      const closePos = pattern.indexOf(":]", i + 2);
      if (closePos !== -1) {
        i = closePos + 2;
        continue;
      }
    }
    i++;
  }
  return -1;
}

/**
 * Convert a shell character class content to regex equivalent.
 * Input is the content inside [...], e.g., ":alpha:" for [[:alpha:]]
 */
function convertCharClass(content: string): string {
  let result = "[";
  let i = 0;

  // Handle negation
  if (content[0] === "^" || content[0] === "!") {
    result += "^";
    i++;
  }

  while (i < content.length) {
    // Handle single quotes inside character class (bash extension)
    // '...' makes its content literal, including ] and -
    if (content[i] === "'") {
      const closeQuote = content.indexOf("'", i + 1);
      if (closeQuote !== -1) {
        // Add quoted content as literal characters
        const quoted = content.slice(i + 1, closeQuote);
        for (const ch of quoted) {
          // Escape regex special chars inside character class
          if (ch === "\\") {
            result += "\\\\";
          } else if (ch === "]") {
            result += "\\]";
          } else if (ch === "^" && result === "[") {
            result += "\\^";
          } else {
            result += ch;
          }
        }
        i = closeQuote + 1;
        continue;
      }
    }

    // Handle POSIX classes like [:alpha:]
    if (
      content[i] === "[" &&
      i + 1 < content.length &&
      content[i + 1] === ":"
    ) {
      const closePos = content.indexOf(":]", i + 2);
      if (closePos !== -1) {
        const posixClass = content.slice(i + 2, closePos);
        result += posixClassToRegex(posixClass);
        i = closePos + 2;
        continue;
      }
    }

    // Handle literal characters (escape regex special chars inside class)
    const char = content[i];
    if (char === "\\") {
      // Escape sequence
      if (i + 1 < content.length) {
        result += "\\" + content[i + 1];
        i += 2;
      } else {
        result += "\\\\";
        i++;
      }
    } else if (char === "-" && i > 0 && i < content.length - 1) {
      // Range separator
      result += "-";
      i++;
    } else if (char === "^" && i === 0) {
      // Negation at start
      result += "^";
      i++;
    } else {
      // Regular character - some need escaping in regex char class
      if (char === "]" && i === 0) {
        result += "\\]";
      } else {
        result += char;
      }
      i++;
    }
  }

  result += "]";
  return result;
}

/**
 * Convert POSIX character class name to regex equivalent
 */
function posixClassToRegex(name: string): string {
  const posixClasses: Record<string, string> = {
    alnum: "a-zA-Z0-9",
    alpha: "a-zA-Z",
    ascii: "\\x00-\\x7F",
    blank: " \\t",
    cntrl: "\\x00-\\x1F\\x7F",
    digit: "0-9",
    graph: "!-~",
    lower: "a-z",
    print: " -~",
    punct: "!-/:-@\\[-`{-~",
    space: " \\t\\n\\r\\f\\v",
    upper: "A-Z",
    word: "a-zA-Z0-9_",
    xdigit: "0-9A-Fa-f",
  };
  return posixClasses[name] || "";
}
