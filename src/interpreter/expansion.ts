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
import { NounsetError } from "./errors.js";
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
 */
function safeExpandNumericRange(
  start: number,
  end: number,
  rawStep: number | undefined,
): string[] | null {
  const step = rawStep ?? 1;

  // step of 0 would cause infinite loop
  if (step === 0) return null;

  const results: string[] = [];

  if (start <= end) {
    // Ascending range
    if (step < 0) return null; // Invalid: ascending with negative step
    for (let i = start, count = 0; i <= end && count < MAX_SAFE_RANGE_ITERATIONS; i += step, count++) {
      results.push(String(i));
    }
  } else {
    // Descending range (start > end)
    if (step > 0) return null; // Invalid: descending with positive step
    const absStep = Math.abs(step);
    for (let i = start, count = 0; i >= end && count < MAX_SAFE_RANGE_ITERATIONS; i -= absStep, count++) {
      results.push(String(i));
    }
  }

  return results;
}

/**
 * Safely expand a character range with step, preventing infinite loops.
 * Returns array of string values, or null if the range is invalid.
 */
function safeExpandCharRange(
  start: string,
  end: string,
  rawStep: number | undefined,
): string[] | null {
  const step = rawStep ?? 1;
  const startCode = start.charCodeAt(0);
  const endCode = end.charCodeAt(0);

  // step of 0 would cause infinite loop
  if (step === 0) return null;

  const results: string[] = [];

  if (startCode <= endCode) {
    // Ascending range
    if (step < 0) return null; // Invalid: ascending with negative step
    for (let i = startCode, count = 0; i <= endCode && count < MAX_SAFE_RANGE_ITERATIONS; i += step, count++) {
      results.push(String.fromCharCode(i));
    }
  } else {
    // Descending range
    if (step > 0) return null; // Invalid: descending with positive step
    const absStep = Math.abs(step);
    for (let i = startCode, count = 0; i >= endCode && count < MAX_SAFE_RANGE_ITERATIONS; i -= absStep, count++) {
      results.push(String.fromCharCode(i));
    }
  }

  return results;
}

// Helper to extract literal value from a word part
function getPartValue(part: WordPart): string {
  switch (part.type) {
    case "Literal":
    case "SingleQuoted":
    case "Escaped":
      return part.value;
    default:
      return "";
  }
}

// Helper to get string value from word parts
function getWordPartsValue(parts: WordPart[]): string {
  return parts.map(getPartValue).join("");
}

/**
 * Check if a word is "fully quoted" - meaning glob characters should be treated literally.
 * A word is fully quoted if all its parts are either:
 * - SingleQuoted
 * - DoubleQuoted (entirely quoted variable expansion like "$pat")
 * - Escaped characters
 */
function isPartFullyQuoted(part: WordPart): boolean {
  switch (part.type) {
    case "SingleQuoted":
    case "Escaped":
      return true;
    case "DoubleQuoted":
      // Double-quoted is fully quoted
      return true;
    case "Literal":
      // Empty literals don't affect quoting
      return part.value === "";
    default:
      // Unquoted expansions like $var (without quotes) are not fully quoted
      return false;
  }
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

// Sync version of expandPart for parts that don't need async
function expandPartSync(ctx: InterpreterContext, part: WordPart): string {
  switch (part.type) {
    case "Literal":
      return part.value;

    case "SingleQuoted":
      return part.value;

    case "DoubleQuoted": {
      const parts: string[] = [];
      for (const p of part.parts) {
        parts.push(expandPartSync(ctx, p));
      }
      return parts.join("");
    }

    case "Escaped":
      return part.value;

    case "ParameterExpansion":
      return expandParameter(ctx, part);

    case "ArithmeticExpansion": {
      const value = evaluateArithmeticSync(ctx, part.expression.expression);
      return String(value);
    }

    case "TildeExpansion":
      if (part.user === null) {
        return ctx.state.env.HOME || "/home/user";
      }
      return `/home/${part.user}`;

    case "BraceExpansion": {
      const results: string[] = [];
      for (const item of part.items) {
        if (item.type === "Range") {
          const start = item.start;
          const end = item.end;
          if (typeof start === "number" && typeof end === "number") {
            const expanded = safeExpandNumericRange(start, end, item.step);
            if (expanded) results.push(...expanded);
          } else if (typeof start === "string" && typeof end === "string") {
            const expanded = safeExpandCharRange(start, end, item.step);
            if (expanded) results.push(...expanded);
          }
        } else {
          results.push(expandWordSync(ctx, item.word));
        }
      }
      return results.join(" ");
    }

    case "Glob":
      return part.pattern;

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
} {
  let hasQuoted = false;
  let hasCommandSub = false;
  let hasArrayVar = false;

  for (const part of parts) {
    if (part.type === "SingleQuoted" || part.type === "DoubleQuoted") {
      hasQuoted = true;
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

  return { hasQuoted, hasCommandSub, hasArrayVar };
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
// Maximum iterations for any single range expansion loop
const MAX_RANGE_ITERATIONS = 10000;
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
      for (const item of part.items) {
        if (item.type === "Range") {
          const start = item.start;
          const end = item.end;
          if (typeof start === "number" && typeof end === "number") {
            const expanded = safeExpandNumericRange(start, end, item.step);
            if (expanded) {
              for (const val of expanded) {
                operationCounter.count++;
                braceValues.push(val);
              }
            }
          } else if (typeof start === "string" && typeof end === "string") {
            const expanded = safeExpandCharRange(start, end, item.step);
            if (expanded) {
              for (const val of expanded) {
                operationCounter.count++;
                braceValues.push(val);
              }
            }
          }
        } else {
          // Word item - expand it (recursively handle nested braces)
          const expanded = expandBracesInParts(ctx, item.word.parts, operationCounter);
          for (const exp of expanded) {
            operationCounter.count++;
            braceValues.push(exp.join(""));
          }
        }
      }

      // Multiply results by brace values (cartesian product)
      // But first check if this would exceed the limit
      const newSize = results.length * braceValues.length;
      if (newSize > MAX_BRACE_EXPANSION_RESULTS || operationCounter.count > MAX_BRACE_OPERATIONS) {
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
  const { hasQuoted, hasCommandSub, hasArrayVar } = analyzeWordParts(wordParts);

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

  // No brace expansion or single value - use original logic
  const needsAsync = wordNeedsAsync(word);
  const value = needsAsync
    ? await expandWordAsync(ctx, word)
    : expandWordSync(ctx, word);

  if (!hasQuoted && (hasCommandSub || hasArrayVar) && value.includes(" ")) {
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
  switch (part.type) {
    case "Literal":
      return part.value;

    case "SingleQuoted":
      return part.value;

    case "DoubleQuoted": {
      const parts: string[] = [];
      for (const p of part.parts) {
        parts.push(await expandPart(ctx, p));
      }
      return parts.join("");
    }

    case "Escaped":
      return part.value;

    case "ParameterExpansion":
      return expandParameter(ctx, part);

    case "CommandSubstitution": {
      const result = await ctx.executeScript(part.body);
      return result.stdout.replace(/\n+$/, "");
    }

    case "ArithmeticExpansion": {
      const value = await evaluateArithmetic(ctx, part.expression.expression);
      return String(value);
    }

    case "TildeExpansion":
      if (part.user === null) {
        return ctx.state.env.HOME || "/home/user";
      }
      return `/home/${part.user}`;

    case "BraceExpansion": {
      const results: string[] = [];
      for (const item of part.items) {
        if (item.type === "Range") {
          const start = item.start;
          const end = item.end;
          if (typeof start === "number" && typeof end === "number") {
            const expanded = safeExpandNumericRange(start, end, item.step);
            if (expanded) results.push(...expanded);
          } else if (typeof start === "string" && typeof end === "string") {
            const expanded = safeExpandCharRange(start, end, item.step);
            if (expanded) results.push(...expanded);
          }
        } else {
          results.push(await expandWord(ctx, item.word));
        }
      }
      return results.join(" ");
    }

    case "Glob":
      return part.pattern;

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
        return getWordPartsValue(operation.word.parts);
      }
      return value;
    }

    case "AssignDefault": {
      const useDefault = isUnset || (operation.checkEmpty && isEmpty);
      if (useDefault && operation.word) {
        const defaultValue = getWordPartsValue(operation.word.parts);
        ctx.state.env[parameter] = defaultValue;
        return defaultValue;
      }
      return value;
    }

    case "ErrorIfUnset": {
      const shouldError = isUnset || (operation.checkEmpty && isEmpty);
      if (shouldError) {
        const message = operation.word
          ? getWordPartsValue(operation.word.parts)
          : `${parameter}: parameter null or not set`;
        throw new Error(message);
      }
      return value;
    }

    case "UseAlternative": {
      const useAlternative = !(isUnset || (operation.checkEmpty && isEmpty));
      if (useAlternative && operation.word) {
        return getWordPartsValue(operation.word.parts);
      }
      return "";
    }

    case "Length":
      return String(value.length);

    case "Substring": {
      const offset = operation.offset
        ? getArithValue(operation.offset.expression)
        : 0;
      const length = operation.length
        ? getArithValue(operation.length.expression)
        : undefined;
      let start = offset;
      if (start < 0) start = Math.max(0, value.length + start);
      if (length !== undefined) {
        if (length < 0) {
          return value.slice(start, Math.max(start, value.length + length));
        }
        return value.slice(start, start + length);
      }
      return value.slice(start);
    }

    case "PatternRemoval": {
      const pattern = operation.pattern
        ? getWordPartsValue(operation.pattern.parts)
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
      const pattern = operation.pattern
        ? getWordPartsValue(operation.pattern.parts)
        : "";
      const replacement = operation.replacement
        ? getWordPartsValue(operation.replacement.parts)
        : "";
      const regex = patternToRegex(pattern, true);
      const flags = operation.all ? "g" : "";
      return value.replace(new RegExp(regex, flags), replacement);
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
      return ctx.state.cwd;
    case "OLDPWD":
      return ctx.state.previousDir;
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
  for (const char of pattern) {
    if (char === "*") {
      regex += greedy ? ".*" : ".*?";
    } else if (char === "?") {
      regex += ".";
    } else if (/[\\^$.|+(){}[\]]/.test(char)) {
      regex += `\\${char}`;
    } else {
      regex += char;
    }
  }
  return regex;
}
