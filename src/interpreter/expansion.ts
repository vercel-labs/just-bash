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
  BraceItem,
  ParameterExpansionPart,
  WordNode,
  WordPart,
} from "../ast/types.js";
import { parseArithmeticExpression } from "../parser/arithmetic-parser.js";
import { Parser } from "../parser/parser.js";
import { GlobExpander } from "../shell/glob.js";
import { evaluateArithmetic, evaluateArithmeticSync } from "./arithmetic.js";
import {
  BadSubstitutionError,
  ExecutionLimitError,
  ExitError,
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
} from "./expansion/variable.js";
import { smartWordSplit } from "./expansion/word-split.js";
import {
  buildIfsCharClassPattern,
  getIfs,
  getIfsSeparator,
  isIfsEmpty,
} from "./helpers/ifs.js";
import { escapeRegex } from "./helpers/regex.js";
import { getLiteralValue, isQuotedPart } from "./helpers/word-parts.js";
import type { InterpreterContext } from "./types.js";

// Re-export for backward compatibility
export { getArrayElements, getVariable } from "./expansion/variable.js";

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
          result += `\\x${code.toString(16).padStart(2, "0")}`;
        } else {
          result += char;
        }
      }
    }
  }
  return `${result}'`;
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

/**
 * Expand word parts using CPS pattern.
 * Single implementation for both sync and async paths.
 */
function expandWordPartsCPS<R>(
  parts: WordPart[],
  inDoubleQuotes: boolean,
  ops: {
    expandPart: (
      part: WordPart,
      inDQ: boolean,
      then: (result: string) => R,
    ) => R;
    done: (result: string) => R;
  },
): R {
  function processPartAt(index: number, accumulated: string[]): R {
    if (index >= parts.length) {
      return ops.done(accumulated.join(""));
    }
    return ops.expandPart(parts[index], inDoubleQuotes, (result) => {
      accumulated.push(result);
      return processPartAt(index + 1, accumulated);
    });
  }
  return processPartAt(0, []);
}

// Helper to fully expand word parts (including variables, arithmetic, etc.)
// inDoubleQuotes flag suppresses tilde expansion
function expandWordPartsSync(
  ctx: InterpreterContext,
  parts: WordPart[],
  inDoubleQuotes = false,
): string {
  return expandWordPartsCPS(parts, inDoubleQuotes, {
    expandPart: (part, inDQ, then) => then(expandPartSync(ctx, part, inDQ)),
    done: (result) => result,
  });
}

// Async version of expandWordPartsSync for parts that contain command substitution
async function expandWordPartsAsync(
  ctx: InterpreterContext,
  parts: WordPart[],
  inDoubleQuotes = false,
): Promise<string> {
  return expandWordPartsCPS(parts, inDoubleQuotes, {
    expandPart: async (part, inDQ, then) =>
      then(await expandPart(ctx, part, inDQ)),
    done: async (result) => result,
  });
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

/**
 * Core part expansion using CPS pattern.
 * Handles DoubleQuoted, ArithmeticExpansion, and BraceExpansion.
 * CommandSubstitution is handled separately in async version.
 */
function expandPartCPS<R>(
  ctx: InterpreterContext,
  part: WordPart,
  inDoubleQuotes: boolean,
  ops: {
    expandPartRecursive: (
      part: WordPart,
      inDoubleQuotes: boolean,
      then: (result: string) => R,
    ) => R;
    expandWord: (word: WordNode, then: (result: string) => R) => R;
    evaluateArithmetic: (expr: ArithExpr, then: (result: number) => R) => R;
    done: (result: string) => R;
  },
): R {
  // Try simple cases first
  const simple = expandSimplePart(ctx, part, inDoubleQuotes);
  if (simple !== null) return ops.done(simple);

  // Handle cases that need recursion
  switch (part.type) {
    case "DoubleQuoted": {
      const subParts = part.parts;
      // Process parts sequentially
      function processPartAt(index: number, accumulated: string[]): R {
        if (index >= subParts.length) {
          return ops.done(accumulated.join(""));
        }
        return ops.expandPartRecursive(subParts[index], true, (result) => {
          accumulated.push(result);
          return processPartAt(index + 1, accumulated);
        });
      }
      return processPartAt(0, []);
    }

    case "ArithmeticExpansion":
      return ops.evaluateArithmetic(part.expression.expression, (result) =>
        ops.done(String(result)),
      );

    case "BraceExpansion": {
      const items = part.items;
      // Process items sequentially
      function processItemAt(index: number, results: string[]): R {
        if (index >= items.length) {
          return ops.done(results.join(" "));
        }
        const item = items[index];
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
            return processItemAt(index + 1, results);
          }
          // Invalid range - return literal immediately
          return ops.done(range.literal);
        }
        return ops.expandWord(item.word, (result) => {
          results.push(result);
          return processItemAt(index + 1, results);
        });
      }
      return processItemAt(0, []);
    }

    default:
      return ops.done("");
  }
}

// Sync version of expandPart for parts that don't need async
// inDoubleQuotes flag suppresses tilde expansion
function expandPartSync(
  ctx: InterpreterContext,
  part: WordPart,
  inDoubleQuotes = false,
): string {
  return expandPartCPS(ctx, part, inDoubleQuotes, {
    expandPartRecursive: (p, inDQ, then) => then(expandPartSync(ctx, p, inDQ)),
    expandWord: (word, then) => then(expandWordSync(ctx, word)),
    evaluateArithmetic: (expr, then) => then(evaluateArithmeticSync(ctx, expr)),
    done: (result) => result,
  });
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

/**
 * Process a single brace expansion item (Range or Word).
 * Returns the expanded values or invalid range info.
 */
function processBraceItem(
  item: BraceItem,
  operationCounter: { count: number },
  expandWordItem: (parts: WordPart[]) => string[][],
): { values: string[]; invalidRange?: string } {
  if (item.type === "Range") {
    const range = expandBraceRange(
      item.start,
      item.end,
      item.step,
      item.startStr,
      item.endStr,
    );
    if (range.expanded) {
      const values: string[] = [];
      for (const val of range.expanded) {
        operationCounter.count++;
        values.push(val);
      }
      return { values };
    }
    return { values: [], invalidRange: range.literal };
  }
  // Word item - expand recursively
  const expanded = expandWordItem(item.word.parts);
  const values: string[] = [];
  for (const exp of expanded) {
    operationCounter.count++;
    values.push(exp.join(""));
  }
  return { values };
}

/**
 * Compute cartesian product of current results with brace values.
 * Returns null if limits exceeded.
 */
function computeCartesianProduct(
  results: string[][],
  braceValues: string[],
  operationCounter: { count: number },
): string[][] | null {
  const newSize = results.length * braceValues.length;
  if (
    newSize > MAX_BRACE_EXPANSION_RESULTS ||
    operationCounter.count > MAX_BRACE_OPERATIONS
  ) {
    return null;
  }

  const newResults: string[][] = [];
  for (const result of results) {
    for (const val of braceValues) {
      operationCounter.count++;
      if (operationCounter.count > MAX_BRACE_OPERATIONS) {
        return newResults.length > 0 ? newResults : null;
      }
      newResults.push([...result, val]);
    }
  }
  return newResults;
}

/**
 * Core brace expansion logic using CPS pattern.
 * Handles both sync and async cases through callbacks.
 */
function expandBracesInPartsCPS<R>(
  parts: WordPart[],
  operationCounter: { count: number },
  ops: {
    processBraceItem: (
      item: BraceItem,
      recurse: (p: WordPart[]) => R,
      then: (result: { values: string[]; invalidRange?: string }) => R,
    ) => R;
    expandPart: (part: WordPart, then: (expanded: string) => R) => R;
    done: (results: string[][]) => R;
    processPartLoop: (
      partIndex: number,
      results: string[][],
      processPart: (partIndex: number, results: string[][]) => R,
    ) => R;
  },
): R {
  if (operationCounter.count > MAX_BRACE_OPERATIONS) {
    return ops.done([[]]);
  }

  function processPartAt(partIndex: number, results: string[][]): R {
    if (partIndex >= parts.length) {
      return ops.done(results);
    }

    const part = parts[partIndex];

    if (part.type === "BraceExpansion") {
      const braceItems = part.items;
      // Process brace items sequentially
      function processItemsAt(itemIndex: number, braceValues: string[]): R {
        if (itemIndex >= braceItems.length) {
          // All items processed, compute cartesian product
          const newResults = computeCartesianProduct(
            results,
            braceValues,
            operationCounter,
          );
          if (newResults === null) {
            return ops.done(results);
          }
          return processPartAt(partIndex + 1, newResults);
        }

        const item = braceItems[itemIndex];
        return ops.processBraceItem(
          item,
          (p) => expandBracesInPartsCPS(p, operationCounter, ops),
          (processed) => {
            if (processed.invalidRange !== undefined) {
              // Invalid range - add literal to all results and continue
              for (const result of results) {
                operationCounter.count++;
                result.push(processed.invalidRange);
              }
              return processPartAt(partIndex + 1, results);
            }
            braceValues.push(...processed.values);
            return processItemsAt(itemIndex + 1, braceValues);
          },
        );
      }

      return processItemsAt(0, []);
    }

    // Not a brace expansion - expand the part
    return ops.expandPart(part, (expanded) => {
      for (const result of results) {
        operationCounter.count++;
        result.push(expanded);
      }
      return processPartAt(partIndex + 1, results);
    });
  }

  return processPartAt(0, [[]]);
}

/**
 * Sync brace expansion
 */
function expandBracesInParts(
  ctx: InterpreterContext,
  parts: WordPart[],
  operationCounter: { count: number } = { count: 0 },
): string[][] {
  return expandBracesInPartsCPS(parts, operationCounter, {
    processBraceItem: (item, recurse, then) => {
      const processed = processBraceItem(item, operationCounter, recurse);
      return then(processed);
    },
    expandPart: (part, then) => then(expandPartSync(ctx, part)),
    done: (results) => results,
    processPartLoop: (partIndex, results, processPart) =>
      processPart(partIndex, results),
  });
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
 * Async brace expansion
 */
async function expandBracesInPartsAsync(
  ctx: InterpreterContext,
  parts: WordPart[],
  operationCounter: { count: number } = { count: 0 },
): Promise<string[][]> {
  return expandBracesInPartsCPS(parts, operationCounter, {
    processBraceItem: async (item, recurse, then) => {
      if (item.type === "Range") {
        // Range is always sync
        return then(processBraceItem(item, operationCounter, () => []));
      }
      // Word item - expand recursively (async)
      const expanded = await recurse(item.word.parts);
      const values: string[] = [];
      for (const exp of expanded) {
        operationCounter.count++;
        values.push(exp.join(""));
      }
      return then({ values });
    },
    expandPart: async (part, then) => then(await expandPart(ctx, part)),
    done: async (results) => results,
    processPartLoop: async (partIndex, results, processPart) =>
      processPart(partIndex, results),
  });
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
        // Inside double quotes, suppress tilde expansion
        prefix += await expandPart(ctx, dqPart.parts[i], true);
      }

      // Expand suffix (parts after $@/$*)
      let suffix = "";
      for (let i = atIndex + 1; i < dqPart.parts.length; i++) {
        // Inside double quotes, suppress tilde expansion
        suffix += await expandPart(ctx, dqPart.parts[i], true);
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

  // Note: Unquoted $@ and $* are handled by normal expansion + word splitting.
  // They expand to positional parameters joined by space, then split on IFS.
  // The special handling above is only for quoted "$@" and "$*" inside double quotes.

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
    // Perform glob expansion on each split value
    const expandedValues: string[] = [];
    const globExpander = new GlobExpander(ctx.fs, ctx.state.cwd);
    for (const sv of splitResult) {
      if (/[*?[]/.test(sv)) {
        const matches = await globExpander.expand(sv);
        if (matches.length > 0) {
          expandedValues.push(...matches);
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

  if (!hasQuoted && /[*?[]/.test(value)) {
    const globExpander = new GlobExpander(ctx.fs, ctx.state.cwd);
    const matches = await globExpander.expand(value);
    if (matches.length > 0) {
      return { values: matches, quoted: false };
    }
  }

  // Empty unquoted expansion produces no words (e.g., $empty where empty is unset/empty)
  // But quoted empty string produces one empty word (e.g., "" or "$empty")
  if (value === "" && !hasQuoted) {
    return { values: [], quoted: false };
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
  inDoubleQuotes = false,
): Promise<string> {
  // Check if ParameterExpansion needs async (has command substitution in operation)
  if (part.type === "ParameterExpansion" && paramExpansionNeedsAsync(part)) {
    return expandParameterAsync(ctx, part, inDoubleQuotes);
  }

  // Handle CommandSubstitution - this is async-only
  if (part.type === "CommandSubstitution") {
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

  // Use shared CPS implementation for common cases
  return expandPartCPS(ctx, part, inDoubleQuotes, {
    expandPartRecursive: async (p, inDQ, then) =>
      then(await expandPart(ctx, p, inDQ)),
    expandWord: async (word, then) => then(await expandWord(ctx, word)),
    evaluateArithmetic: async (expr, then) =>
      then(await evaluateArithmetic(ctx, expr)),
    done: async (result) => result,
  });
}

/**
 * Applies pattern removal to a value.
 * Shared by sync and async versions of expandParameter.
 */
function applyPatternRemoval(
  value: string,
  regexStr: string,
  side: "prefix" | "suffix",
  greedy: boolean,
): string {
  if (side === "prefix") {
    return value.replace(new RegExp(`^${regexStr}`), "");
  }
  // Suffix removal needs special handling
  const regex = new RegExp(`${regexStr}$`);
  if (greedy) {
    // %% - longest match: use regex directly
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

/**
 * Applies pattern replacement to a value.
 * Shared by sync and async versions of expandParameter.
 */
function applyPatternReplacement(
  value: string,
  regex: string,
  replacement: string,
  anchor: "start" | "end" | null | undefined,
  all: boolean,
): string {
  // Empty pattern means no replacement
  if (regex === "") {
    return value;
  }

  let finalRegex = regex;
  if (anchor === "start") {
    finalRegex = `^${finalRegex}`;
  } else if (anchor === "end") {
    finalRegex = `${finalRegex}$`;
  }
  const flags = all ? "g" : "";

  try {
    const re = new RegExp(finalRegex, flags);
    if (all) {
      // For global replace, avoid matching empty string at end
      let result = "";
      let lastIndex = 0;
      let match: RegExpExecArray | null = re.exec(value);
      while (match !== null) {
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

/**
 * Builds a regex string from pattern parts using continuation-passing style.
 * This single implementation handles both sync and async cases.
 *
 * For sync: R = string, callbacks return immediately
 * For async: R = Promise<string>, callbacks chain promises
 */
function buildPatternRegexCPS<R>(
  pattern: { parts: WordPart[] } | undefined,
  greedy: boolean,
  ops: {
    expandWordParts: (parts: WordPart[], then: (result: string) => R) => R;
    expandPart: (part: WordPart, then: (result: string) => R) => R;
    done: (result: string) => R;
  },
): R {
  if (!pattern || pattern.parts.length === 0) return ops.done("");

  const parts = pattern.parts;

  // Process parts recursively with continuations
  function processParts(index: number, accumulated: string): R {
    if (index >= parts.length) {
      return ops.done(accumulated);
    }

    const part = parts[index];

    if (part.type === "Glob") {
      return processParts(
        index + 1,
        accumulated + patternToRegex(part.pattern, greedy),
      );
    }
    if (part.type === "Literal") {
      return processParts(
        index + 1,
        accumulated + patternToRegex(part.value, greedy),
      );
    }
    if (part.type === "SingleQuoted" || part.type === "Escaped") {
      return processParts(index + 1, accumulated + escapeRegex(part.value));
    }
    if (part.type === "DoubleQuoted") {
      return ops.expandWordParts(part.parts, (expanded) =>
        processParts(index + 1, accumulated + escapeRegex(expanded)),
      );
    }
    if (part.type === "ParameterExpansion") {
      return ops.expandPart(part, (expanded) =>
        processParts(index + 1, accumulated + patternToRegex(expanded, greedy)),
      );
    }
    return ops.expandPart(part, (expanded) =>
      processParts(index + 1, accumulated + escapeRegex(expanded)),
    );
  }

  return processParts(0, "");
}

/**
 * Builds a regex string from pattern parts synchronously.
 */
function buildPatternRegexSync(
  ctx: InterpreterContext,
  pattern: { parts: WordPart[] } | undefined,
  greedy: boolean,
): string {
  return buildPatternRegexCPS(pattern, greedy, {
    expandWordParts: (parts, then) => then(expandWordPartsSync(ctx, parts)),
    expandPart: (part, then) => then(expandPartSync(ctx, part)),
    done: (result) => result,
  });
}

/**
 * Builds a regex string from pattern parts asynchronously.
 */
async function buildPatternRegexAsync(
  ctx: InterpreterContext,
  pattern: { parts: WordPart[] } | undefined,
  greedy: boolean,
): Promise<string> {
  return buildPatternRegexCPS(pattern, greedy, {
    expandWordParts: async (parts, then) =>
      then(await expandWordPartsAsync(ctx, parts)),
    expandPart: async (part, then) => then(await expandPart(ctx, part)),
    done: async (result) => result,
  });
}

/**
 * Compute a slice of an array of items (positional params or array values).
 * Handles negative offsets (count from end) and negative lengths (end position from end).
 */
function sliceItems(
  items: string[],
  offset: number,
  length: number | undefined,
): string {
  let start = offset;
  if (start < 0) {
    start = items.length + start;
    if (start < 0) return "";
  }
  if (start >= items.length) return "";

  if (length === undefined) {
    return items.slice(start).join(" ");
  }
  if (length < 0) {
    const endPos = items.length + length;
    return items.slice(start, Math.max(start, endPos)).join(" ");
  }
  return items.slice(start, start + length).join(" ");
}

/**
 * Compute a substring of a string value with UTF-8 support.
 * Handles negative offsets (count from end) and negative lengths (end position from end).
 */
function sliceString(
  value: string,
  offset: number,
  length: number | undefined,
): string {
  const chars = [...value]; // Handle multi-byte UTF-8 characters
  let start = offset;
  if (start < 0) start = Math.max(0, chars.length + start);

  if (length === undefined) {
    return chars.slice(start).join("");
  }
  if (length < 0) {
    const endPos = chars.length + length;
    return chars.slice(start, Math.max(start, endPos)).join("");
  }
  return chars.slice(start, start + length).join("");
}

/**
 * Assign a value to an array element, updating the array length if needed.
 * Handles the common pattern of `arr[index] = value` in parameter expansion.
 */
function assignArrayElement(
  ctx: InterpreterContext,
  arrayName: string,
  index: number,
  value: string,
): void {
  const normalizedIndex = Number.isNaN(index) ? 0 : index;
  ctx.state.env[`${arrayName}_${normalizedIndex}`] = value;
  const currentLength = Number.parseInt(
    ctx.state.env[`${arrayName}__length`] || "0",
    10,
  );
  if (normalizedIndex >= currentLength) {
    ctx.state.env[`${arrayName}__length`] = String(normalizedIndex + 1);
  }
}

/**
 * Core parameter expansion using CPS (Continuation-Passing Style) pattern.
 * Single implementation for both sync and async paths.
 *
 * CPS Callback Contract:
 * - Each callback (`then`, `done`) must be invoked exactly once per code path
 * - Callbacks may throw exceptions (e.g., ExitError), which propagate normally
 * - The return value of the callback becomes the return value of the CPS function
 *
 * For sync (R = string):
 *   - All callbacks execute synchronously and return immediately
 *   - `done(value)` returns value directly
 *
 * For async (R = Promise<string>):
 *   - Callbacks may be async and return promises
 *   - `done(value)` returns a resolved promise
 */
function expandParameterCPS<R>(
  ctx: InterpreterContext,
  part: ParameterExpansionPart,
  inDoubleQuotes: boolean,
  ops: {
    /** Expand word parts, pass result to continuation */
    expandWordParts: (
      parts: WordPart[],
      inDQ: boolean,
      then: (result: string) => R,
    ) => R;
    /** Evaluate arithmetic expression, pass result to continuation */
    evaluateArithmetic: (expr: ArithExpr, then: (result: number) => R) => R;
    /** Build pattern regex, pass result to continuation */
    buildPatternRegex: (
      pattern: { parts: WordPart[] } | undefined,
      greedy: boolean,
      then: (result: string) => R,
    ) => R;
    /** Return a final result from the CPS function */
    done: (result: string) => R;
  },
): R {
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
    return ops.done(value);
  }

  const isUnset = !(parameter in ctx.state.env);
  const isEmpty = value === "";

  switch (operation.type) {
    case "DefaultValue": {
      const useDefault = isUnset || (operation.checkEmpty && isEmpty);
      if (useDefault && operation.word) {
        return ops.expandWordParts(
          operation.word.parts,
          inDoubleQuotes,
          ops.done,
        );
      }
      return ops.done(value);
    }

    case "AssignDefault": {
      const useDefault = isUnset || (operation.checkEmpty && isEmpty);
      if (useDefault && operation.word) {
        return ops.expandWordParts(
          operation.word.parts,
          inDoubleQuotes,
          (defaultValue) => {
            // Handle array subscript assignment (e.g., arr[0]=x)
            const arrayMatch = parameter.match(
              /^([a-zA-Z_][a-zA-Z0-9_]*)\[(.+)\]$/,
            );
            if (arrayMatch) {
              const [, arrayName, subscriptExpr] = arrayMatch;
              // Simple numeric index - assign directly
              if (/^\d+$/.test(subscriptExpr)) {
                assignArrayElement(
                  ctx,
                  arrayName,
                  Number.parseInt(subscriptExpr, 10),
                  defaultValue,
                );
                return ops.done(defaultValue);
              }
              // Arithmetic expression - evaluate then assign
              try {
                const parser = new Parser();
                const arithAst = parseArithmeticExpression(
                  parser,
                  subscriptExpr,
                );
                return ops.evaluateArithmetic(arithAst.expression, (index) => {
                  assignArrayElement(ctx, arrayName, index, defaultValue);
                  return ops.done(defaultValue);
                });
              } catch {
                // Fallback: treat as variable name
                const varValue = ctx.state.env[subscriptExpr];
                const index = varValue ? Number.parseInt(varValue, 10) : 0;
                assignArrayElement(ctx, arrayName, index, defaultValue);
                return ops.done(defaultValue);
              }
            }
            // Simple variable assignment
            ctx.state.env[parameter] = defaultValue;
            return ops.done(defaultValue);
          },
        );
      }
      return ops.done(value);
    }

    case "ErrorIfUnset": {
      const shouldError = isUnset || (operation.checkEmpty && isEmpty);
      if (shouldError) {
        if (operation.word) {
          return ops.expandWordParts(
            operation.word.parts,
            inDoubleQuotes,
            (message) => {
              throw new ExitError(1, "", `bash: ${message}\n`);
            },
          );
        }
        throw new ExitError(
          1,
          "",
          `bash: ${parameter}: parameter null or not set\n`,
        );
      }
      return ops.done(value);
    }

    case "UseAlternative": {
      const useAlternative = !(isUnset || (operation.checkEmpty && isEmpty));
      if (useAlternative && operation.word) {
        return ops.expandWordParts(
          operation.word.parts,
          inDoubleQuotes,
          ops.done,
        );
      }
      return ops.done("");
    }

    case "Length": {
      const arrayMatch = parameter.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\[[@*]\]$/);
      if (arrayMatch) {
        const elements = getArrayElements(ctx, arrayMatch[1]);
        return ops.done(String(elements.length));
      }
      if (
        /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(parameter) &&
        isArray(ctx, parameter)
      ) {
        const firstElement = ctx.state.env[`${parameter}_0`] || "";
        return ops.done(String(firstElement.length));
      }
      return ops.done(String(value.length));
    }

    case "LengthSliceError":
      throw new BadSubstitutionError(parameter);

    case "Substring": {
      // Compute the final slice result once we have offset and length
      const computeSubstring = (offset: number, length: number | undefined) => {
        // ${@:offset} and ${*:offset} - slice positional parameters
        if (parameter === "@" || parameter === "*") {
          const args = (ctx.state.env["@"] || "").split(" ").filter((a) => a);
          const shellName = ctx.state.env["0"] || "bash";
          // At offset 0, include $0; otherwise use 1-based indexing
          const allArgs = offset === 0 ? [shellName, ...args] : args;
          const startIdx = offset === 0 ? 0 : offset - 1;
          return ops.done(sliceItems(allArgs, startIdx, length));
        }

        // ${arr[@]:offset} or ${arr[*]:offset} - slice array elements
        const arrayMatch = parameter.match(
          /^([a-zA-Z_][a-zA-Z0-9_]*)\[[@*]\]$/,
        );
        if (arrayMatch) {
          const elements = getArrayElements(ctx, arrayMatch[1]);
          const values = elements.map(([, v]) => v);
          return ops.done(sliceItems(values, offset, length));
        }

        // ${var:offset} - slice string value
        return ops.done(sliceString(value, offset, length));
      };

      // Evaluate offset (default 0), then length (default undefined), then compute
      const offsetExpr = operation.offset?.expression;
      const lengthExpr = operation.length?.expression;

      const evalOffset = offsetExpr
        ? (then: (n: number) => R) => ops.evaluateArithmetic(offsetExpr, then)
        : (then: (n: number) => R) => then(0);

      const evalLength = lengthExpr
        ? (offset: number, then: (off: number, len: number | undefined) => R) =>
            ops.evaluateArithmetic(lengthExpr, (len) => then(offset, len))
        : (offset: number, then: (off: number, len: number | undefined) => R) =>
            then(offset, undefined);

      return evalOffset((offset) =>
        evalLength(offset, (off, len) => computeSubstring(off, len)),
      );
    }

    case "PatternRemoval":
      return ops.buildPatternRegex(
        operation.pattern,
        operation.greedy,
        (regexStr) =>
          ops.done(
            applyPatternRemoval(
              value,
              regexStr,
              operation.side,
              operation.greedy,
            ),
          ),
      );

    case "PatternReplacement":
      return ops.buildPatternRegex(operation.pattern, true, (regex) => {
        if (operation.replacement) {
          return ops.expandWordParts(
            operation.replacement.parts,
            false,
            (replacement) =>
              ops.done(
                applyPatternReplacement(
                  value,
                  regex,
                  replacement,
                  operation.anchor,
                  operation.all,
                ),
              ),
          );
        }
        return ops.done(
          applyPatternReplacement(
            value,
            regex,
            "",
            operation.anchor,
            operation.all,
          ),
        );
      });

    case "CaseModification":
      if (operation.direction === "upper") {
        return ops.done(
          operation.all
            ? value.toUpperCase()
            : value.charAt(0).toUpperCase() + value.slice(1),
        );
      }
      return ops.done(
        operation.all
          ? value.toLowerCase()
          : value.charAt(0).toLowerCase() + value.slice(1),
      );

    case "Transform": {
      const arrayMatch = parameter.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\[[@*]\]$/);
      if (arrayMatch && operation.operator === "Q") {
        const elements = getArrayElements(ctx, arrayMatch[1]);
        const quotedElements = elements.map(([, v]) => quoteValue(v));
        return ops.done(quotedElements.join(" "));
      }

      switch (operation.operator) {
        case "Q":
          return ops.done(quoteValue(value));
        case "P":
          return ops.done(value);
        case "a":
          return ops.done("");
        case "A":
          return ops.done(`${parameter}=${quoteValue(value)}`);
        case "E":
          return ops.done(
            value.replace(/\\([\\abefnrtv'"?])/g, (_, c) => {
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
            }),
          );
        case "K":
          return ops.done("");
        default:
          return ops.done(value);
      }
    }

    case "Indirection":
      return ops.done(getVariable(ctx, value));

    case "ArrayKeys": {
      const elements = getArrayElements(ctx, operation.array);
      const keys = elements.map(([k]) => String(k));
      if (operation.star) {
        return ops.done(keys.join(getIfsSeparator(ctx.state.env)));
      }
      return ops.done(keys.join(" "));
    }

    case "VarNamePrefix": {
      const matchingVars = Object.keys(ctx.state.env)
        .filter((k) => k.startsWith(operation.prefix) && !k.includes("__"))
        .sort();
      if (operation.star) {
        return ops.done(matchingVars.join(getIfsSeparator(ctx.state.env)));
      }
      return ops.done(matchingVars.join(" "));
    }

    default:
      return ops.done(value);
  }
}

function expandParameter(
  ctx: InterpreterContext,
  part: ParameterExpansionPart,
  inDoubleQuotes = false,
): string {
  return expandParameterCPS(ctx, part, inDoubleQuotes, {
    expandWordParts: (parts, inDQ, then) =>
      then(expandWordPartsSync(ctx, parts, inDQ)),
    evaluateArithmetic: (expr, then) => then(evaluateArithmeticSync(ctx, expr)),
    buildPatternRegex: (pattern, greedy, then) =>
      then(buildPatternRegexSync(ctx, pattern, greedy)),
    done: (result) => result,
  });
}

// Async version of expandParameter for parameter expansions that contain command substitution
async function expandParameterAsync(
  ctx: InterpreterContext,
  part: ParameterExpansionPart,
  inDoubleQuotes = false,
): Promise<string> {
  return expandParameterCPS(ctx, part, inDoubleQuotes, {
    expandWordParts: async (parts, inDQ, then) =>
      then(await expandWordPartsAsync(ctx, parts, inDQ)),
    evaluateArithmetic: async (expr, then) =>
      then(await evaluateArithmetic(ctx, expr)),
    buildPatternRegex: async (pattern, greedy, then) =>
      then(await buildPatternRegexAsync(ctx, pattern, greedy)),
    done: async (result) => result,
  });
}
