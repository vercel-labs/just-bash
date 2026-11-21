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
import {
  awkParseNumber,
  isAwkNumericString,
  isTruthy,
} from "./interpreter/type-coercion.js";
import type { AwkValue } from "./interpreter/types.js";
import {
  chargedSizeOfArray,
  getArrayStore,
  getVariable,
  initialSizeOfArray,
  isScalarVariable,
  isStrnumArrayKey,
  replaceArrayValues,
  resolveArrayName,
  setSpecialStoreSize,
  setStrnumArrayKeys,
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
    // A sub/gsub result is a plain string, never a numeric string.
    ctx.strnumVars?.delete(targetName);
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

  // Resolve aliases and the ARGV/ENVIRON stores, like element access
  // does: splitting into a function parameter, ARGV, or ENVIRON must
  // write the real array, not a shadow under the name as written.
  const resolvedArrayName = resolveArrayName(ctx, arrayName);
  const store = getArrayStore(ctx, arrayName, resolvedArrayName);
  // Only the charged part of the array being replaced frees room: the
  // prepopulated ARGV/ENVIRON contents are exempt from the allowance.
  const previousCharged = chargedSizeOfArray(ctx, arrayName, resolvedArrayName);
  // Validate the initial count before splitting anything: the running
  // total must at least cover the charged part of the array being
  // replaced. A stale or under-counted total would otherwise overstate
  // the room available and let the split exceed the element limit.
  if (
    !Number.isFinite(ctx.arrayElementCount) ||
    ctx.arrayElementCount < previousCharged
  ) {
    throw new ExecutionLimitError(
      `array element limit exceeded (${ctx.maxArrayElements})`,
      "array_elements",
    );
  }
  // Clamp the room to zero or more. When the other arrays already fill
  // (or exceed) the limit, `available` goes negative, and a negative
  // limit means "unbounded" to both split implementations below:
  // String.split converts it with ToUint32, and UserRegex.split falls
  // back to maxResults for a negative limit. Either way the split
  // would do unbounded work on the input before the length check
  // below could reject it, so the bound must hold before splitting.
  // The baseline counts too: a split into ARGV/ENVIRON fits wholly in
  // the store's exempt slots when its parts fit the prepopulated size,
  // even when other arrays fill the allowance.
  const baseline = initialSizeOfArray(ctx, arrayName, resolvedArrayName);
  const available = Math.max(
    0,
    ctx.maxArrayElements - ctx.arrayElementCount + previousCharged + baseline,
  );
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

  // Replace the resolved store in place (a new null-prototype record
  // for a program array that does not exist yet), then adjust the
  // count by the charged-size change: the new parts count only past
  // the prepopulated size, like any other write into ARGV/ENVIRON.
  const target: Record<string, AwkValue> = store ?? Object.create(null);
  if (store === undefined) {
    ctx.arrays[resolvedArrayName] = target;
  }
  for (const key of Object.keys(target)) {
    delete target[key];
  }
  for (let i = 0; i < parts.length; i++) {
    target[String(i + 1)] = parts[i];
  }
  const newCharged = Math.max(0, parts.length - baseline);
  ctx.arrayElementCount = Math.max(
    0,
    ctx.arrayElementCount - previousCharged + newCharged,
  );
  // The target store is rebuilt with the parts, so its live size and
  // strnum keys are rebuilt too: split fields are numeric strings
  // when they look numeric, as in gawk.
  if (target === ctx.ARGV || target === ctx.ENVIRON) {
    setSpecialStoreSize(ctx, target, parts.length);
  }
  const strnumKeys = new Set<string>();
  for (let i = 0; i < parts.length; i++) {
    if (isAwkNumericString(parts[i])) strnumKeys.add(String(i + 1));
  }
  setStrnumArrayKeys(ctx, resolvedArrayName, strnumKeys);

  return parts.length;
}

/**
 * Compare two strings the way gawk does: by code point, which is the
 * same order as UTF-8 bytes — not by UTF-16 code unit, so a
 * supplementary character (emoji U+1F600) sorts after a BMP character
 * with a lower code point (full-width Ａ U+FF21).
 */
function compareCodePoints(a: string, b: string): number {
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const ca = a.codePointAt(i) ?? 0;
    const cb = b.codePointAt(j) ?? 0;
    if (ca !== cb) return ca < cb ? -1 : 1;
    i += ca > 0xffff ? 2 : 1;
    j += cb > 0xffff ? 2 : 1;
  }
  if (i < a.length) return 1;
  if (j < b.length) return -1;
  return 0;
}

/**
 * AWK string comparison: code-point order, or with IGNORECASE set,
 * case-folded first with ties broken by the case-sensitive order, as
 * gawk does (b,A,a,B -> A a B b).
 */
function compareAwkStrings(a: string, b: string, ignoreCase: boolean): number {
  if (!ignoreCase) return compareCodePoints(a, b);
  const folded = compareCodePoints(a.toLowerCase(), b.toLowerCase());
  return folded !== 0 ? folded : compareCodePoints(a, b);
}

function compareNumbers(a: number, b: number): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Format a JS number as gawk formats it for a string comparison
 * (CONVFMT, default "%.6g"): integers keep their full decimal form
 * ("1000000000", not "1e+09") and non-integers use CONVFMT, with the
 * exponent padded to two digits as C's %g does ("9e-05", not "9e-5").
 * A CONVFMT the formatter rejects falls back to String(value).
 */
function formatAwkNumber(ctx: AwkRuntimeContext, value: number): string {
  if (Number.isInteger(value)) return String(value);
  const format = ctx.CONVFMT || "%.6g";
  try {
    const str = formatPrintf(format, [value], awkStringLimit(ctx));
    return str.replace(/e([+-]?)(\d)$/, "e$10$2");
  } catch {
    return String(value);
  }
}

/**
 * gawk asort(source [, dest [, how]]): sort an array's values and reindex
 * them 1..n. Without dest the source is sorted in place; with dest the
 * source is left unchanged and the sorted values land in dest. Passing the
 * same array as source and dest (asort(x, x)) is explicitly supported and
 * behaves like sorting in place: the values are snapshotted before the
 * destination is replaced, so the sort cannot clobber its own input.
 * Returns the number of elements. ARGV and ENVIRON are read and written
 * through their dedicated storage, the same place element access uses. The
 * default comparison is a total order matching gawk's: numeric values —
 * JS numbers and numeric strings (strnums) from input fields or split()
 * — sort first, numerically (ties broken by string value, as gawk
 * does), and plain string values follow in string order, so literal
 * "10" sorts before "9". This deliberately differs from the
 * interpreter's `<` rules for mixed types: `<` compares two
 * numeric-looking strings numerically ("10" < "9" is false there) and
 * can cycle for mixed values, so `<`-consistency cannot give a
 * deterministic sort order. An empty how string means the default
 * ordering, as in gawk. The optional how argument also accepts the
 * gawk "@val_num_asc", "@val_num_desc", "@val_str_asc" and
 * "@val_str_desc" modes; the numeric modes parse values the way AWK
 * does ("Infinity" is 0, not infinite) and break ties between
 * numerically equal values with a string comparison, as gawk does.
 * String comparisons use gawk's ordering: code points (not UTF-16
 * code units), CONVFMT formatting for numbers, and IGNORECASE when
 * it is set.
 */
async function awkAsort(
  args: AwkExpr[],
  ctx: AwkRuntimeContext,
  evaluator: AwkEvaluator,
): Promise<number> {
  // Validate arity and operand types before touching either array:
  // gawk rejects these calls, and a scalar source used to be treated as
  // an empty array, silently wiping the destination. Uninitialized
  // names are not scalars, so asort of a never-assigned array still
  // returns 0, as before.
  if (args.length === 0 || args.length > 3) {
    throw new Error(
      `asort: wrong number of arguments (expected 1 to 3, got ${args.length})`,
    );
  }
  if (args[0].type !== "variable") {
    throw new Error("asort: first argument is not an array");
  }
  if (isScalarVariable(ctx, args[0].name)) {
    throw new Error("asort: first argument is not an array");
  }
  const sourceRaw = args[0].name;

  let destRaw = sourceRaw;
  if (args.length >= 2) {
    if (args[1].type !== "variable") {
      throw new Error("asort: second argument is not an array");
    }
    if (isScalarVariable(ctx, args[1].name)) {
      throw new Error("asort: second argument is not an array");
    }
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
  // An empty how string is the default ordering, as in gawk.
  if (howSupplied && how !== "" && !numericOnly && !stringOnly) {
    throw new Error(`asort: unsupported how argument "${how}"`);
  }
  const descending = how.endsWith("_desc");

  // Snapshot the source only after the other arguments have been
  // evaluated: gawk passes arrays by reference, so a `how` expression
  // that modifies the source is visible to the sort.
  const sourceStore = getArrayStore(ctx, sourceRaw, resolvedSource);
  const values: AwkValue[] = sourceStore ? Object.values(sourceStore) : [];
  // Numeric-string provenance of the source elements, aligned with
  // `values` (Object.keys and Object.values share an order): input
  // fields and split() parts are strnums, string literals are not.
  const sourceIsStrnum = sourceStore
    ? Object.keys(sourceStore).map((key) =>
        isStrnumArrayKey(ctx, resolvedSource, key),
      )
    : [];

  // Convert each value once up front: the comparator runs O(n log n)
  // times, so converting inside it would redo the string/number
  // conversion on every comparison. The work is charged by the data
  // actually scanned — one unit per value plus one per KiB of its
  // string form — and the abort signal is polled every 1024 values,
  // so a long conversion can be interrupted instead of running
  // synchronously to completion. parseFloat runs only where a numeric
  // value is actually needed: the numeric modes, and numeric strings
  // in the default mode. The string-only mode and plain strings in
  // the default mode never pay for a conversion.
  const scope = ctx.executionScope;
  const ignoreCase = isTruthy(getVariable(ctx, "IGNORECASE"));
  const entries: {
    value: AwkValue;
    str: string;
    num: number;
    isNum: boolean;
    isStrnum: boolean;
  }[] = [];
  let pendingConversionWork = 0;
  const pollConversion = (): void => {
    if (pendingConversionWork > 0) {
      scope?.consumeWork(pendingConversionWork, "asort value conversion");
      pendingConversionWork = 0;
    }
    scope?.throwIfAborted("asort value conversion");
  };
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    const isStrnum = sourceIsStrnum[i] ?? false;
    const isNum = typeof value === "number" || isStrnum;
    // Numbers compare by their CONVFMT form in string modes and in
    // numeric tie-breaks; strings compare by their own spelling.
    const str =
      typeof value === "number"
        ? formatAwkNumber(ctx, value)
        : toAwkString(value);
    const num =
      typeof value === "number"
        ? value
        : numericOnly || isNum
          ? awkParseNumber(str)
          : 0;
    entries.push({ value, str, num, isNum, isStrnum });
    pendingConversionWork += 1 + (str.length >> 10);
    if ((i + 1) % 1024 === 0) pollConversion();
  }
  pollConversion();

  // A large array needs O(n log n) comparisons, so the comparator
  // charges work and polls the abort signal every 1024 comparisons
  // instead of on each one. A comparison costs one unit plus one per
  // KiB of the shorter string actually scanned, so long common
  // prefixes pay for the work they do; the remainder is flushed after
  // the sort. Without an execution scope (interpreter used directly)
  // only the array-element limit bounds the sort. The abort check
  // runs between comparisons: native Array.sort cannot yield
  // mid-comparison, so a single comparison over very long strings
  // still runs to completion, but it is charged for its scan.
  let comparisons = 0;
  let pendingComparisonWork = 0;
  const compare = (
    a: { str: string; num: number; isNum: boolean },
    b: { str: string; num: number; isNum: boolean },
  ): number => {
    let result: number;
    let stringCompared = false;
    if (numericOnly) {
      result = compareNumbers(a.num, b.num);
      // gawk breaks numeric ties with the string values so the ordering
      // does not depend on the underlying sort implementation.
      if (result === 0) {
        result = compareAwkStrings(a.str, b.str, ignoreCase);
        stringCompared = true;
      }
    } else if (stringOnly) {
      result = compareAwkStrings(a.str, b.str, ignoreCase);
      stringCompared = true;
    } else if (a.isNum !== b.isNum) {
      // Total order (gawk's default): numeric values sort before
      // string values, so a strnum "10" sorts before the string "9"
      // only when it came from input/split; a literal "10" is a
      // string and sorts before "9" lexically. The old
      // looks-like-a-number rule cycled for mixed values such as
      // "1a", 2, 10 ("1a" < "2" as strings, 2 < 10 numerically, but
      // "1a" > "10" as strings), so the sort order depended on the
      // input permutation.
      result = a.isNum ? -1 : 1;
    } else if (a.isNum) {
      result = compareNumbers(a.num, b.num);
      // gawk breaks numeric ties with the string values so the ordering
      // does not depend on the underlying sort implementation.
      if (result === 0) {
        result = compareAwkStrings(a.str, b.str, ignoreCase);
        stringCompared = true;
      }
    } else {
      result = compareAwkStrings(a.str, b.str, ignoreCase);
      stringCompared = true;
    }
    comparisons++;
    pendingComparisonWork +=
      1 + (stringCompared ? Math.min(a.str.length, b.str.length) >> 10 : 0);
    if (comparisons % 1024 === 0) {
      scope?.consumeWork(pendingComparisonWork, "asort comparison");
      pendingComparisonWork = 0;
      scope?.throwIfAborted("asort sort");
    }
    return descending ? -result : result;
  };
  entries.sort(compare);
  if (pendingComparisonWork > 0) {
    scope?.consumeWork(pendingComparisonWork, "asort comparison");
    pendingComparisonWork = 0;
  }

  // The values are already copied above, so replacing the destination is
  // safe even when dest is the source.
  replaceArrayValues(
    ctx,
    destRaw,
    entries.map((entry) => entry.value),
    resolvedDest,
  );
  // The destination's numeric-string keys follow the sorted values: a
  // strnum stays one wherever it lands.
  const destStrnumKeys = new Set<string>();
  entries.forEach((entry, index) => {
    if (entry.isStrnum) destStrnumKeys.add(String(index + 1));
  });
  setStrnumArrayKeys(ctx, resolvedDest, destStrnumKeys);
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
