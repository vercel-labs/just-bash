/**
 * AWK Built-in Functions
 *
 * Implementation of AWK built-in functions for the AST-based interpreter.
 */

import { BoundedStringBuilder } from "../../bounded-builder.js";
import { utf8ByteLength } from "../../encoding.js";
import { rethrowFatalExecutionError } from "../../fatal-execution-error.js";
import { ExecutionLimitError } from "../../interpreter/errors.js";
import { createUserRegex, type UserRegex } from "../../regex/index.js";
import type { AwkExpr } from "./ast.js";
import type { AwkRuntimeContext } from "./interpreter/context.js";
import {
  ensureFieldCount,
  rebuildLine,
  splitFields,
} from "./interpreter/fields.js";
import { looksLikeNumber } from "./interpreter/type-coercion.js";
import type { AwkValue } from "./interpreter/types.js";
import {
  getArrayStore,
  replaceArrayValues,
  resolveArrayName,
} from "./interpreter/variables.js";

/**
 * Interface for evaluating expressions (passed from interpreter)
 */
export interface AwkEvaluator {
  evalExpr: (expr: AwkExpr) => Promise<AwkValue>;
}

export type AwkBuiltinFn = (
  args: AwkExpr[],
  ctx: AwkRuntimeContext,
  evaluator: AwkEvaluator,
) => AwkValue | Promise<AwkValue>;

// Helper functions for type conversion
function toNumber(val: AwkValue): number {
  if (typeof val === "number") return val;
  const n = parseFloat(val);
  return Number.isNaN(n) ? 0 : n;
}

function toAwkString(val: AwkValue): string {
  if (typeof val === "string") return val;
  if (Number.isInteger(val)) return String(val);
  return String(val);
}

const DEFAULT_AWK_STRING_LIMIT = 10 * 1024 * 1024;

function createAwkStringBuilder(maxBytes: number): BoundedStringBuilder {
  return new BoundedStringBuilder(
    maxBytes,
    "awk string",
    () =>
      new ExecutionLimitError(
        `string size limit exceeded (${maxBytes} bytes)`,
        "string_length",
      ),
  );
}

function awkStringLimit(ctx: AwkRuntimeContext): number {
  return ctx.maxOutputSize > 0 ? ctx.maxOutputSize : DEFAULT_AWK_STRING_LIMIT;
}

function boundedRegexReplace(
  target: string,
  regex: UserRegex,
  shouldReplace: (matchNumber: number) => boolean,
  replacer: (match: RegExpMatchArray) => string,
  maxBytes: number,
): { value: string; replacements: number } {
  const output = createAwkStringBuilder(maxBytes);
  let cursor = 0;
  let matchNumber = 0;
  let replacements = 0;
  for (const match of regex.matchAll(target)) {
    const index = match.index ?? 0;
    matchNumber++;
    output.append(target.slice(cursor, index));
    if (shouldReplace(matchNumber)) {
      output.append(replacer(match));
      replacements++;
    } else {
      output.append(match[0]);
    }
    cursor = index + match[0].length;
  }
  output.append(target.slice(cursor));
  return { value: output.build(), replacements };
}

/**
 * Extract a regex pattern from an AWK expression argument.
 * Handles both regex literals and string expressions.
 */
async function extractPatternArg(
  arg: AwkExpr,
  evaluator: AwkEvaluator,
): Promise<string> {
  if (arg.type === "regex") {
    return arg.pattern;
  }
  let pattern = toAwkString(await evaluator.evalExpr(arg));
  if (pattern.startsWith("/") && pattern.endsWith("/")) {
    pattern = pattern.slice(1, -1);
  }
  return pattern;
}

/**
 * Resolve a target variable name from a sub/gsub third argument.
 * Returns the variable name (e.g., "myvar", "$0", "$1").
 */
async function resolveTargetName(
  targetExpr: AwkExpr | undefined,
  evaluator: AwkEvaluator,
): Promise<string> {
  if (!targetExpr) return "$0";
  if (targetExpr.type === "variable") {
    return targetExpr.name;
  }
  if (targetExpr.type === "field") {
    const idx = Math.floor(
      toNumber(await evaluator.evalExpr(targetExpr.index)),
    );
    return `$${idx}`;
  }
  return "$0";
}

/**
 * Get the current value of a target variable.
 */
function getTargetValue(targetName: string, ctx: AwkRuntimeContext): string {
  if (targetName === "$0") {
    return ctx.line;
  }
  if (targetName.startsWith("$")) {
    const idx = Number(targetName.slice(1)) - 1;
    return ctx.fields[idx] || "";
  }
  return toAwkString(ctx.vars[targetName] ?? "");
}

/**
 * Apply a new value to a target variable, updating $0 and fields as needed.
 */
function applyTargetValue(
  targetName: string,
  newValue: string,
  ctx: AwkRuntimeContext,
): void {
  if (targetName === "$0") {
    ctx.line = newValue;
    ctx.fields = splitFields(ctx, newValue);
    ctx.NF = ctx.fields.length;
  } else if (targetName.startsWith("$")) {
    const idx = Number(targetName.slice(1)) - 1;
    ensureFieldCount(ctx, idx + 1);
    ctx.fields[idx] = newValue;
    ctx.NF = ctx.fields.length;
    rebuildLine(ctx);
  } else {
    ctx.vars[targetName] = newValue;
  }
}

// ─── String Functions ───────────────────────────────────────────

async function awkLength(
  args: AwkExpr[],
  ctx: AwkRuntimeContext,
  evaluator: AwkEvaluator,
): Promise<number> {
  if (args.length === 0) {
    return ctx.line.length;
  }
  const str = toAwkString(await evaluator.evalExpr(args[0]));
  return str.length;
}

async function awkSubstr(
  args: AwkExpr[],
  _ctx: AwkRuntimeContext,
  evaluator: AwkEvaluator,
): Promise<string> {
  if (args.length < 2) return "";
  const str = toAwkString(await evaluator.evalExpr(args[0]));
  const start = Math.floor(toNumber(await evaluator.evalExpr(args[1]))) - 1;

  if (args.length >= 3) {
    const len = Math.floor(toNumber(await evaluator.evalExpr(args[2])));
    return str.substr(Math.max(0, start), len);
  }
  return str.substr(Math.max(0, start));
}

async function awkIndex(
  args: AwkExpr[],
  _ctx: AwkRuntimeContext,
  evaluator: AwkEvaluator,
): Promise<number> {
  if (args.length < 2) return 0;
  const str = toAwkString(await evaluator.evalExpr(args[0]));
  const target = toAwkString(await evaluator.evalExpr(args[1]));
  const idx = str.indexOf(target);
  return idx === -1 ? 0 : idx + 1;
}

async function awkSplit(
  args: AwkExpr[],
  ctx: AwkRuntimeContext,
  evaluator: AwkEvaluator,
): Promise<number> {
  if (args.length < 2) return 0;
  const str = toAwkString(await evaluator.evalExpr(args[0]));

  const arrayExpr = args[1];
  if (arrayExpr.type !== "variable") {
    return 0;
  }
  const arrayName = arrayExpr.name;

  let sep: string | UserRegex = ctx.FS;
  if (args.length >= 3) {
    const sepExpr = args[2];
    // Check if the separator is a regex literal
    if (sepExpr.type === "regex") {
      sep = createUserRegex(sepExpr.pattern);
    } else {
      const sepVal = toAwkString(await evaluator.evalExpr(sepExpr));
      sep = sepVal === " " ? createUserRegex("\\s+") : sepVal;
    }
  } else if (ctx.FS === " ") {
    sep = createUserRegex("\\s+");
  }

  const previousCount = Object.keys(ctx.arrays[arrayName] ?? {}).length;
  const available =
    ctx.maxArrayElements - ctx.arrayElementCount + previousCount;
  const parts =
    typeof sep === "string"
      ? str.split(sep, available + 1)
      : sep.split(str, available + 1);
  if (parts.length > available) {
    throw new ExecutionLimitError(
      `array element limit exceeded (${ctx.maxArrayElements})`,
      "array_elements",
    );
  }

  // Use null-prototype to prevent prototype pollution with user-controlled keys
  ctx.arrays[arrayName] = Object.create(null);
  for (let i = 0; i < parts.length; i++) {
    ctx.arrays[arrayName][String(i + 1)] = parts[i];
  }
  ctx.arrayElementCount += parts.length - previousCount;

  return parts.length;
}

/**
 * gawk asort(source [, dest [, how]]): sort an array's values and reindex
 * them 1..n. Without dest the source is sorted in place; with dest the
 * source is left unchanged and the sorted values land in dest. Returns the
 * number of elements. ARGV and ENVIRON are read and written through their
 * dedicated storage, the same place element access uses. The default
 * comparison follows the interpreter's `<` rules: values that both look
 * numeric compare numerically, otherwise they compare as strings. (This
 * differs from gawk's asort default, which puts numbers/strnums before
 * strings; the interpreter has no strnum attribute to express that
 * distinction, so `<`-consistency wins.) The optional how argument
 * accepts the gawk "@val_num_asc", "@val_num_desc", "@val_str_asc" and
 * "@val_str_desc" modes; the numeric modes break ties between numerically
 * equal values with a string comparison, as gawk does. An explicitly
 * supplied how must be one of those four modes — including the empty
 * string, which is an error rather than the default ordering.
 */
async function awkAsort(
  args: AwkExpr[],
  ctx: AwkRuntimeContext,
  evaluator: AwkEvaluator,
): Promise<number> {
  if (args.length === 0 || args[0].type !== "variable") return 0;
  const sourceRaw = args[0].name;

  let destRaw = sourceRaw;
  if (args.length >= 2) {
    if (args[1].type !== "variable") return 0;
    destRaw = args[1].name;
  }

  // Resolve aliases before evaluating `how`: a `how` function call can
  // take an array parameter under the same name and drop the alias this
  // call relies on when it returns.
  const resolvedSource = resolveArrayName(ctx, sourceRaw);
  const resolvedDest = resolveArrayName(ctx, destRaw);

  let how = "";
  let howSupplied = false;
  if (args.length >= 3) {
    howSupplied = true;
    how = toAwkString(await evaluator.evalExpr(args[2]));
  }
  const numericOnly = how === "@val_num_asc" || how === "@val_num_desc";
  const stringOnly = how === "@val_str_asc" || how === "@val_str_desc";
  if (howSupplied && !numericOnly && !stringOnly) {
    throw new Error(`asort: unsupported how argument "${how}"`);
  }
  const descending = how.endsWith("_desc");

  // Snapshot the source only after the other arguments have been
  // evaluated: gawk passes arrays by reference, so a `how` expression
  // that modifies the source is visible to the sort.
  const sourceStore = getArrayStore(ctx, sourceRaw, resolvedSource);
  const values: AwkValue[] = sourceStore ? Object.values(sourceStore) : [];

  // Convert each value once up front: the comparator runs O(n log n)
  // times, so converting inside it would redo the string/number
  // conversion on every comparison.
  const entries = values.map((value) => ({
    value,
    str: toAwkString(value),
    num: toNumber(value),
    isNum: looksLikeNumber(value),
  }));

  // Charge the sort to the shared work budget and let an abort interrupt
  // it: a large array needs O(n log n) comparisons, so the comparator
  // charges one unit and polls the abort signal every 1024 comparisons
  // instead of on each one. Without an execution scope (interpreter used
  // directly) only the array-element limit bounds the sort.
  const scope = ctx.executionScope;
  scope?.consumeWork(values.length, "asort value conversion");
  let comparisons = 0;
  const chargeSortWork = (): void => {
    comparisons++;
    if (comparisons % 1024 !== 0) return;
    scope?.consumeWork(1, "asort comparison");
    scope?.throwIfAborted("asort sort");
  };

  const compareStrings = (a: string, b: string): number =>
    a < b ? -1 : a > b ? 1 : 0;
  const compareNumbers = (a: number, b: number): number =>
    a < b ? -1 : a > b ? 1 : 0;
  const compare = (
    a: { value: AwkValue; str: string; num: number; isNum: boolean },
    b: { value: AwkValue; str: string; num: number; isNum: boolean },
  ): number => {
    chargeSortWork();
    let result: number;
    if (numericOnly) {
      result = compareNumbers(a.num, b.num);
      // gawk breaks numeric ties with the string values so the ordering
      // does not depend on the underlying sort implementation.
      if (result === 0) result = compareStrings(a.str, b.str);
    } else if (stringOnly) {
      result = compareStrings(a.str, b.str);
    } else if (a.isNum && b.isNum) {
      result = compareNumbers(a.num, b.num);
    } else {
      // Same fallback as the interpreter's `<`: string comparison.
      result = compareStrings(a.str, b.str);
    }
    return descending ? -result : result;
  };
  entries.sort(compare);

  // The values are already copied above, so replacing the destination is
  // safe even when dest is the source.
  replaceArrayValues(
    ctx,
    destRaw,
    entries.map((entry) => entry.value),
    resolvedDest,
  );
  return values.length;
}

async function awkSub(
  args: AwkExpr[],
  ctx: AwkRuntimeContext,
  evaluator: AwkEvaluator,
): Promise<number> {
  if (args.length < 2) return 0;

  const pattern = await extractPatternArg(args[0], evaluator);
  const replacement = toAwkString(await evaluator.evalExpr(args[1]));
  const targetName = await resolveTargetName(args[2], evaluator);
  const target = getTargetValue(targetName, ctx);

  try {
    const regex = createUserRegex(pattern, "g");
    const replaced = boundedRegexReplace(
      target,
      regex,
      (matchNumber) => matchNumber === 1,
      (match) =>
        createSubReplacement(replacement, match[0], awkStringLimit(ctx)),
      awkStringLimit(ctx),
    );
    applyTargetValue(targetName, replaced.value, ctx);
    return replaced.replacements;
  } catch (error) {
    rethrowFatalExecutionError(error);
    return 0;
  }
}

async function awkGsub(
  args: AwkExpr[],
  ctx: AwkRuntimeContext,
  evaluator: AwkEvaluator,
): Promise<number> {
  if (args.length < 2) return 0;

  const pattern = await extractPatternArg(args[0], evaluator);
  const replacement = toAwkString(await evaluator.evalExpr(args[1]));
  const targetName = await resolveTargetName(args[2], evaluator);
  const target = getTargetValue(targetName, ctx);

  try {
    const regex = createUserRegex(pattern, "g");
    const replaced = boundedRegexReplace(
      target,
      regex,
      () => true,
      (match) =>
        createSubReplacement(replacement, match[0], awkStringLimit(ctx)),
      awkStringLimit(ctx),
    );
    applyTargetValue(targetName, replaced.value, ctx);
    return replaced.replacements;
  } catch (error) {
    rethrowFatalExecutionError(error);
    return 0;
  }
}

function createSubReplacement(
  replacement: string,
  match: string,
  maxBytes: number,
): string {
  const result = createAwkStringBuilder(maxBytes);
  let i = 0;
  while (i < replacement.length) {
    if (replacement[i] === "\\" && i + 1 < replacement.length) {
      const next = replacement[i + 1];
      if (next === "&") {
        result.append("&");
        i += 2;
      } else if (next === "\\") {
        result.append("\\");
        i += 2;
      } else {
        result.append(replacement[i + 1]);
        i += 2;
      }
    } else if (replacement[i] === "&") {
      result.append(match);
      i++;
    } else {
      result.append(replacement[i]);
      i++;
    }
  }
  return result.build();
}

async function awkMatch(
  args: AwkExpr[],
  ctx: AwkRuntimeContext,
  evaluator: AwkEvaluator,
): Promise<number> {
  if (args.length < 2) {
    ctx.RSTART = 0;
    ctx.RLENGTH = -1;
    return 0;
  }

  const str = toAwkString(await evaluator.evalExpr(args[0]));
  const pattern = await extractPatternArg(args[1], evaluator);

  try {
    const regex = createUserRegex(pattern);
    const match = regex.exec(str);
    if (match) {
      ctx.RSTART = match.index + 1;
      ctx.RLENGTH = match[0].length;
      return ctx.RSTART;
    }
  } catch {
    // Invalid regex
  }

  ctx.RSTART = 0;
  ctx.RLENGTH = -1;
  return 0;
}

async function awkGensub(
  args: AwkExpr[],
  ctx: AwkRuntimeContext,
  evaluator: AwkEvaluator,
): Promise<string> {
  if (args.length < 3) return "";

  const pattern = await extractPatternArg(args[0], evaluator);
  const replacement = toAwkString(await evaluator.evalExpr(args[1]));
  const how = toAwkString(await evaluator.evalExpr(args[2]));
  const target =
    args.length >= 4
      ? toAwkString(await evaluator.evalExpr(args[3]))
      : ctx.line;

  try {
    const isGlobal = how.toLowerCase() === "g";
    const occurrenceNum = isGlobal ? 0 : parseInt(how, 10) || 1;

    if (isGlobal) {
      const regex = createUserRegex(pattern, "g");
      return boundedRegexReplace(
        target,
        regex,
        () => true,
        (match) =>
          processGensub(
            replacement,
            match[0],
            match.slice(1),
            awkStringLimit(ctx),
          ),
        awkStringLimit(ctx),
      ).value;
    } else {
      const regex = createUserRegex(pattern, "g");
      return boundedRegexReplace(
        target,
        regex,
        (matchNumber) => matchNumber === occurrenceNum,
        (match) =>
          processGensub(
            replacement,
            match[0],
            match.slice(1),
            awkStringLimit(ctx),
          ),
        awkStringLimit(ctx),
      ).value;
    }
  } catch (error) {
    rethrowFatalExecutionError(error);
    return target;
  }
}

function processGensub(
  replacement: string,
  match: string,
  groups: string[],
  maxBytes: number,
): string {
  const result = createAwkStringBuilder(maxBytes);
  let i = 0;
  while (i < replacement.length) {
    if (replacement[i] === "\\" && i + 1 < replacement.length) {
      const next = replacement[i + 1];
      if (next === "&") {
        result.append("&");
        i += 2;
      } else if (next === "0") {
        result.append(match);
        i += 2;
      } else if (next >= "1" && next <= "9") {
        const idx = parseInt(next, 10) - 1;
        result.append(groups[idx] || "");
        i += 2;
      } else if (next === "n") {
        result.append("\n");
        i += 2;
      } else if (next === "t") {
        result.append("\t");
        i += 2;
      } else {
        result.append(next);
        i += 2;
      }
    } else if (replacement[i] === "&") {
      result.append(match);
      i++;
    } else {
      result.append(replacement[i]);
      i++;
    }
  }
  return result.build();
}

async function awkTolower(
  args: AwkExpr[],
  _ctx: AwkRuntimeContext,
  evaluator: AwkEvaluator,
): Promise<string> {
  if (args.length === 0) return "";
  return toAwkString(await evaluator.evalExpr(args[0])).toLowerCase();
}

async function awkToupper(
  args: AwkExpr[],
  _ctx: AwkRuntimeContext,
  evaluator: AwkEvaluator,
): Promise<string> {
  if (args.length === 0) return "";
  return toAwkString(await evaluator.evalExpr(args[0])).toUpperCase();
}

async function awkSprintf(
  args: AwkExpr[],
  ctx: AwkRuntimeContext,
  evaluator: AwkEvaluator,
): Promise<string> {
  if (args.length === 0) return "";
  const format = toAwkString(await evaluator.evalExpr(args[0]));
  const values: AwkValue[] = [];
  for (let i = 1; i < args.length; i++) {
    values.push(await evaluator.evalExpr(args[i]));
  }
  return formatPrintf(format, values, awkStringLimit(ctx));
}

// ─── Math Functions ─────────────────────────────────────────────

async function awkInt(
  args: AwkExpr[],
  _ctx: AwkRuntimeContext,
  evaluator: AwkEvaluator,
): Promise<number> {
  if (args.length === 0) return 0;
  return Math.floor(toNumber(await evaluator.evalExpr(args[0])));
}

async function awkSqrt(
  args: AwkExpr[],
  _ctx: AwkRuntimeContext,
  evaluator: AwkEvaluator,
): Promise<number> {
  if (args.length === 0) return 0;
  return Math.sqrt(toNumber(await evaluator.evalExpr(args[0])));
}

async function awkSin(
  args: AwkExpr[],
  _ctx: AwkRuntimeContext,
  evaluator: AwkEvaluator,
): Promise<number> {
  if (args.length === 0) return 0;
  return Math.sin(toNumber(await evaluator.evalExpr(args[0])));
}

async function awkCos(
  args: AwkExpr[],
  _ctx: AwkRuntimeContext,
  evaluator: AwkEvaluator,
): Promise<number> {
  if (args.length === 0) return 0;
  return Math.cos(toNumber(await evaluator.evalExpr(args[0])));
}

async function awkAtan2(
  args: AwkExpr[],
  _ctx: AwkRuntimeContext,
  evaluator: AwkEvaluator,
): Promise<number> {
  const y = args.length > 0 ? toNumber(await evaluator.evalExpr(args[0])) : 0;
  const x = args.length > 1 ? toNumber(await evaluator.evalExpr(args[1])) : 0;
  return Math.atan2(y, x);
}

async function awkLog(
  args: AwkExpr[],
  _ctx: AwkRuntimeContext,
  evaluator: AwkEvaluator,
): Promise<number> {
  if (args.length === 0) return 0;
  return Math.log(toNumber(await evaluator.evalExpr(args[0])));
}

async function awkExp(
  args: AwkExpr[],
  _ctx: AwkRuntimeContext,
  evaluator: AwkEvaluator,
): Promise<number> {
  if (args.length === 0) return 1;
  return Math.exp(toNumber(await evaluator.evalExpr(args[0])));
}

function awkRand(
  _args: AwkExpr[],
  ctx: AwkRuntimeContext,
  _evaluator: AwkEvaluator,
): number {
  return ctx.random ? ctx.random() : Math.random();
}

async function awkSrand(
  args: AwkExpr[],
  ctx: AwkRuntimeContext,
  evaluator: AwkEvaluator,
): Promise<number> {
  const seed =
    args.length > 0 ? toNumber(await evaluator.evalExpr(args[0])) : Date.now();
  ctx.vars._srand_seed = seed;
  return seed;
}

// ─── Unsupported Functions ──────────────────────────────────────

function unsupported(name: string, reason: string): AwkBuiltinFn {
  return () => {
    throw new Error(`${name}() is not supported - ${reason}`);
  };
}

function unimplemented(name: string): AwkBuiltinFn {
  return () => {
    throw new Error(`function '${name}()' is not implemented`);
  };
}

// ─── Printf Formatting ──────────────────────────────────────────

const MAX_PRINTF_WIDTH = 10000;

export function formatPrintf(
  format: string,
  values: AwkValue[],
  maxBytes: number = DEFAULT_AWK_STRING_LIMIT,
): string {
  let valueIdx = 0;
  let result = "";
  let resultBytes = 0;
  let i = 0;
  const maxFieldWidth = Math.min(MAX_PRINTF_WIDTH, maxBytes);
  const append = (value: string): void => {
    const bytes = utf8ByteLength(value);
    if (bytes > maxBytes - resultBytes) {
      throw new ExecutionLimitError(
        `formatted string size limit exceeded (${maxBytes} bytes)`,
        "string_length",
      );
    }
    result += value;
    resultBytes += bytes;
  };

  while (i < format.length) {
    if (format[i] === "%" && i + 1 < format.length) {
      let j = i + 1;
      let flags = "";
      let width = "";
      let precision = "";
      let positionalIdx: number | undefined;

      // Check for positional argument: %n$ where n is a number
      const posStart = j;
      while (j < format.length && /\d/.test(format[j])) {
        j++;
      }
      if (j > posStart && format[j] === "$") {
        // Found positional argument like %2$
        positionalIdx = parseInt(format.substring(posStart, j), 10) - 1; // Convert to 0-based
        j++; // Skip the $
      } else {
        // Not positional, reset j
        j = posStart;
      }

      // Skip length modifiers (l, ll, z, j, h, hh) - they're ignored in AWK but shouldn't break parsing
      const skipLengthMods = () => {
        if (j < format.length) {
          // Check for hh or ll first (2-char modifiers)
          if (
            j + 1 < format.length &&
            ((format[j] === "h" && format[j + 1] === "h") ||
              (format[j] === "l" && format[j + 1] === "l"))
          ) {
            j += 2;
            return;
          }
          // Check for single-char modifiers
          if (/[lzjh]/.test(format[j])) {
            j++;
          }
        }
      };

      while (j < format.length && /[-+ #0]/.test(format[j])) {
        flags += format[j++];
      }

      // Handle * for width
      if (format[j] === "*") {
        const widthVal = values[valueIdx++];
        const w = widthVal !== undefined ? Math.floor(Number(widthVal)) : 0;
        if (!Number.isFinite(w) || !Number.isSafeInteger(w)) {
          throw new ExecutionLimitError(
            `printf width limit exceeded (${maxFieldWidth} bytes)`,
            "string_length",
          );
        }
        if (w < 0) {
          flags += "-";
          width = String(-w);
        } else {
          width = String(w);
        }
        j++;
      } else {
        while (j < format.length && /\d/.test(format[j])) {
          width += format[j++];
        }
      }
      if (width && parseInt(width, 10) > maxFieldWidth) {
        throw new ExecutionLimitError(
          `printf width limit exceeded (${maxFieldWidth} bytes)`,
          "string_length",
        );
      }

      if (format[j] === ".") {
        j++;
        // Handle * for precision
        if (format[j] === "*") {
          const precVal = values[valueIdx++];
          const parsedPrecision =
            precVal !== undefined ? Math.floor(Number(precVal)) : 0;
          if (
            !Number.isFinite(parsedPrecision) ||
            !Number.isSafeInteger(parsedPrecision)
          ) {
            throw new ExecutionLimitError(
              `printf precision limit exceeded (${maxFieldWidth} bytes)`,
              "string_length",
            );
          }
          precision = parsedPrecision < 0 ? "" : String(parsedPrecision);
          j++;
        } else {
          while (j < format.length && /\d/.test(format[j])) {
            precision += format[j++];
          }
        }
        if (precision && parseInt(precision, 10) > maxFieldWidth) {
          throw new ExecutionLimitError(
            `printf precision limit exceeded (${maxFieldWidth} bytes)`,
            "string_length",
          );
        }
      }

      // Skip length modifiers before the specifier
      skipLengthMods();

      const spec = format[j];
      // Use positional index if specified, otherwise use sequential index
      const valIdx = positionalIdx !== undefined ? positionalIdx : valueIdx;
      const val = values[valIdx];

      switch (spec) {
        case "s": {
          let str = val !== undefined ? String(val) : "";
          if (precision) {
            str = str.substring(0, parseInt(precision, 10));
          }
          if (width) {
            const w = parseInt(width, 10);
            if (flags.includes("-")) {
              str = str.padEnd(w);
            } else {
              str = str.padStart(w);
            }
          }
          append(str);
          if (positionalIdx === undefined) valueIdx++;
          break;
        }

        case "d":
        case "i": {
          let num = val !== undefined ? Math.floor(Number(val)) : 0;
          if (Number.isNaN(num)) num = 0;
          const isNegative = num < 0;
          let digits = Math.abs(num).toString();

          // Precision for integers means minimum number of digits (zero-padded)
          if (precision) {
            const prec = parseInt(precision, 10);
            digits = digits.padStart(prec, "0");
          }

          // Add sign
          let sign = "";
          if (isNegative) {
            sign = "-";
          } else if (flags.includes("+")) {
            sign = "+";
          } else if (flags.includes(" ")) {
            sign = " ";
          }

          let str = sign + digits;

          if (width) {
            const w = parseInt(width, 10);
            if (flags.includes("-")) {
              str = str.padEnd(w);
            } else if (flags.includes("0") && !precision) {
              // Zero-padding only applies when no precision is specified
              str = sign + digits.padStart(w - sign.length, "0");
            } else {
              str = str.padStart(w);
            }
          }
          append(str);
          if (positionalIdx === undefined) valueIdx++;
          break;
        }

        case "f": {
          let num = val !== undefined ? Number(val) : 0;
          if (Number.isNaN(num)) num = 0;
          const prec = precision ? parseInt(precision, 10) : 6;
          if (prec > 100) {
            throw new ExecutionLimitError(
              "printf floating-point precision limit exceeded (100 digits)",
              "string_length",
            );
          }
          let str = num.toFixed(prec);
          if (width) {
            const w = parseInt(width, 10);
            if (flags.includes("-")) {
              str = str.padEnd(w);
            } else {
              str = str.padStart(w);
            }
          }
          append(str);
          if (positionalIdx === undefined) valueIdx++;
          break;
        }

        case "e":
        case "E": {
          let num = val !== undefined ? Number(val) : 0;
          if (Number.isNaN(num)) num = 0;
          const prec = precision ? parseInt(precision, 10) : 6;
          if (prec > 100) {
            throw new ExecutionLimitError(
              "printf floating-point precision limit exceeded (100 digits)",
              "string_length",
            );
          }
          let str = num.toExponential(prec);
          if (spec === "E") str = str.toUpperCase();
          if (width) {
            const w = parseInt(width, 10);
            if (flags.includes("-")) {
              str = str.padEnd(w);
            } else {
              str = str.padStart(w);
            }
          }
          append(str);
          if (positionalIdx === undefined) valueIdx++;
          break;
        }

        case "g":
        case "G": {
          let num = val !== undefined ? Number(val) : 0;
          if (Number.isNaN(num)) num = 0;
          const prec = precision ? parseInt(precision, 10) : 6;
          if (prec > 100) {
            throw new ExecutionLimitError(
              "printf floating-point precision limit exceeded (100 digits)",
              "string_length",
            );
          }
          const exp = num !== 0 ? Math.floor(Math.log10(Math.abs(num))) : 0;
          let str: string;
          if (num === 0) {
            str = "0";
          } else if (exp < -4 || exp >= prec) {
            str = num.toExponential(prec - 1);
            if (spec === "G") str = str.toUpperCase();
          } else {
            str = num.toPrecision(prec);
          }
          // Remove trailing zeros after decimal point, but keep at least one digit
          // Must not match standalone "0" (which has no decimal point)
          if (str.includes(".")) {
            str = str.replace(/\.?0+$/, "").replace(/\.?0+e/, "e");
          }
          if (str.includes("e")) {
            str = str.replace(/\.?0+e/, "e");
          }
          if (width) {
            const w = parseInt(width, 10);
            if (flags.includes("-")) {
              str = str.padEnd(w);
            } else {
              str = str.padStart(w);
            }
          }
          append(str);
          if (positionalIdx === undefined) valueIdx++;
          break;
        }

        case "x":
        case "X": {
          let num = val !== undefined ? Math.floor(Number(val)) : 0;
          if (Number.isNaN(num)) num = 0;
          let digits = Math.abs(num).toString(16);
          if (spec === "X") digits = digits.toUpperCase();

          // Precision for hex means minimum number of digits (zero-padded)
          if (precision) {
            const prec = parseInt(precision, 10);
            digits = digits.padStart(prec, "0");
          }

          const sign = num < 0 ? "-" : "";
          let str = sign + digits;

          if (width) {
            const w = parseInt(width, 10);
            if (flags.includes("-")) {
              str = str.padEnd(w);
            } else if (flags.includes("0") && !precision) {
              str = sign + digits.padStart(w - sign.length, "0");
            } else {
              str = str.padStart(w);
            }
          }
          append(str);
          if (positionalIdx === undefined) valueIdx++;
          break;
        }

        case "o": {
          let num = val !== undefined ? Math.floor(Number(val)) : 0;
          if (Number.isNaN(num)) num = 0;
          let digits = Math.abs(num).toString(8);

          // Precision for octal means minimum number of digits (zero-padded)
          if (precision) {
            const prec = parseInt(precision, 10);
            digits = digits.padStart(prec, "0");
          }

          const sign = num < 0 ? "-" : "";
          let str = sign + digits;

          if (width) {
            const w = parseInt(width, 10);
            if (flags.includes("-")) {
              str = str.padEnd(w);
            } else if (flags.includes("0") && !precision) {
              str = sign + digits.padStart(w - sign.length, "0");
            } else {
              str = str.padStart(w);
            }
          }
          append(str);
          if (positionalIdx === undefined) valueIdx++;
          break;
        }

        case "c": {
          if (typeof val === "number") {
            append(String.fromCharCode(val));
          } else {
            append(String(val ?? "").charAt(0) || "");
          }
          if (positionalIdx === undefined) valueIdx++;
          break;
        }

        case "%":
          append("%");
          break;

        default:
          append(format.substring(i, j + 1));
      }
      i = j + 1;
    } else if (format[i] === "\\" && i + 1 < format.length) {
      const esc = format[i + 1];
      switch (esc) {
        case "n":
          append("\n");
          break;
        case "t":
          append("\t");
          break;
        case "r":
          append("\r");
          break;
        case "\\":
          append("\\");
          break;
        default:
          append(esc);
      }
      i += 2;
    } else {
      append(format[i++]);
    }
  }

  return result;
}

// ─── Built-in Function Registry ─────────────────────────────────

export const awkBuiltins: Map<string, AwkBuiltinFn> = new Map([
  // String functions
  ["length", awkLength],
  ["substr", awkSubstr],
  ["index", awkIndex],
  ["split", awkSplit],
  ["asort", awkAsort],
  ["sub", awkSub],
  ["gsub", awkGsub],
  ["match", awkMatch],
  ["gensub", awkGensub],
  ["tolower", awkTolower],
  ["toupper", awkToupper],
  ["sprintf", awkSprintf],

  // Math functions
  ["int", awkInt],
  ["sqrt", awkSqrt],
  ["sin", awkSin],
  ["cos", awkCos],
  ["atan2", awkAtan2],
  ["log", awkLog],
  ["exp", awkExp],
  ["rand", awkRand],
  ["srand", awkSrand],

  // Unsupported functions (security/sandboxing)
  [
    "system",
    unsupported(
      "system",
      "shell execution not allowed in sandboxed environment",
    ),
  ],
  // close() and fflush() are no-ops in our environment (no real file handles)
  // Return 0 for success to allow programs that use them to work
  ["close", () => 0],
  ["fflush", () => 0],

  // Unimplemented functions
  ["systime", unimplemented("systime")],
  ["mktime", unimplemented("mktime")],
  ["strftime", unimplemented("strftime")],
]);
