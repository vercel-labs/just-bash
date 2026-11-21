/**
 * AWK Variable and Array Operations
 *
 * Handles user variables, built-in variables, and arrays.
 */

import { ExecutionLimitError } from "../../../interpreter/errors.js";
import type { AwkRuntimeContext } from "./context.js";
import { ensureFieldCount, rebuildLine, setFieldSeparator } from "./fields.js";
import { toAwkString, toNumber } from "./type-coercion.js";
import type { AwkValue } from "./types.js";

/**
 * Get a variable value. Handles built-in variables.
 */
export function getVariable(ctx: AwkRuntimeContext, name: string): AwkValue {
  switch (name) {
    case "FS":
      return ctx.FS;
    case "OFS":
      return ctx.OFS;
    case "ORS":
      return ctx.ORS;
    case "OFMT":
      return ctx.OFMT;
    case "CONVFMT":
      return ctx.CONVFMT;
    case "NR":
      return ctx.NR;
    case "NF":
      return ctx.NF;
    case "FNR":
      return ctx.FNR;
    case "FILENAME":
      return ctx.FILENAME;
    case "RSTART":
      return ctx.RSTART;
    case "RLENGTH":
      return ctx.RLENGTH;
    case "SUBSEP":
      return ctx.SUBSEP;
    case "ARGC":
      return ctx.ARGC;
  }

  return ctx.vars[name] ?? "";
}

/**
 * Set a variable value. Handles built-in variables with special behavior.
 */
export function setVariable(
  ctx: AwkRuntimeContext,
  name: string,
  value: AwkValue,
): void {
  switch (name) {
    case "FS":
      setFieldSeparator(ctx, toAwkString(value));
      return;
    case "OFS":
      ctx.OFS = toAwkString(value);
      return;
    case "ORS":
      ctx.ORS = toAwkString(value);
      return;
    case "OFMT":
      ctx.OFMT = toAwkString(value);
      return;
    case "CONVFMT":
      ctx.CONVFMT = toAwkString(value);
      return;
    case "NR":
      ctx.NR = Math.floor(toNumber(value));
      return;
    case "NF": {
      const newNF = Math.floor(toNumber(value));
      if (!Number.isFinite(newNF)) {
        // Rejects NaN and both infinities before touching fields
        ensureFieldCount(ctx, newNF);
      } else if (newNF < 0) {
        throw new Error("NF set to negative value");
      } else if (newNF < ctx.NF) {
        ctx.fields = ctx.fields.slice(0, newNF);
        rebuildLine(ctx);
      } else if (!(newNF <= ctx.NF)) {
        // Also taken when the current NF is NaN
        ensureFieldCount(ctx, newNF);
        rebuildLine(ctx);
      }
      ctx.NF = newNF;
      return;
    }
    case "FNR":
      ctx.FNR = Math.floor(toNumber(value));
      return;
    case "FILENAME":
      ctx.FILENAME = toAwkString(value);
      return;
    case "RSTART":
      ctx.RSTART = Math.floor(toNumber(value));
      return;
    case "RLENGTH":
      ctx.RLENGTH = Math.floor(toNumber(value));
      return;
    case "SUBSEP":
      ctx.SUBSEP = toAwkString(value);
      return;
    case "ARGC":
      // Assigning ARGC in BEGIN is the standard way to drop input
      // files (gawk reads ARGV[1..ARGC-1]); it used to land in
      // ctx.vars and never reach the field getVariable reads.
      ctx.ARGC = Math.floor(toNumber(value));
      return;
  }

  ctx.vars[name] = value;
  // A scalar write through this path carries no provenance: only the
  // assignment evaluator (which can see the right-hand side) may
  // re-mark the variable as a numeric string afterwards.
  ctx.strnumVars?.delete(name);
}

/**
 * Resolve array name through aliases (for function parameter passing).
 */
export function resolveArrayName(
  ctx: AwkRuntimeContext,
  array: string,
): string {
  // Follow alias chain to get the real array name
  let resolved = array;
  const seen = new Set<string>();
  let alias = ctx.arrayAliases.get(resolved);
  while (alias !== undefined && !seen.has(resolved)) {
    seen.add(resolved);
    resolved = alias;
    alias = ctx.arrayAliases.get(resolved);
  }
  return resolved;
}

/**
 * The record that backs an array, or undefined when the array does not
 * exist. ARGV and ENVIRON live outside ctx.arrays (their elements are
 * read through the special cases in getArrayElement), so they are
 * resolved here too, under both the name as written and its
 * alias-resolved form.
 */
export function getArrayStore(
  ctx: AwkRuntimeContext,
  rawName: string,
  resolvedName: string,
): Record<string, AwkValue> | undefined {
  if (rawName === "ARGV" || resolvedName === "ARGV") return ctx.ARGV;
  if (rawName === "ENVIRON" || resolvedName === "ENVIRON") return ctx.ENVIRON;
  return ctx.arrays[resolvedName];
}

/**
 * Live element count of a prepopulated store, tracked incrementally
 * (see ctx.specialStoreSizes). Falls back to a one-off key scan for a
 * context built without the map, e.g. a hand-built test context.
 */
export function specialStoreSize(
  ctx: AwkRuntimeContext,
  store: Record<string, AwkValue>,
): number {
  if (store === ctx.ARGV) {
    return ctx.specialStoreSizes?.get("ARGV") ?? Object.keys(store).length;
  }
  if (store === ctx.ENVIRON) {
    return ctx.specialStoreSizes?.get("ENVIRON") ?? Object.keys(store).length;
  }
  return Object.keys(store).length;
}

/**
 * Record a prepopulated store's live element count after a bulk
 * write (replace/split) that already knows the new size. No-op for
 * program-created arrays.
 */
export function setSpecialStoreSize(
  ctx: AwkRuntimeContext,
  store: Record<string, AwkValue>,
  size: number,
): void {
  if (!ctx.specialStoreSizes) ctx.specialStoreSizes = new Map();
  if (store === ctx.ARGV) ctx.specialStoreSizes.set("ARGV", size);
  else if (store === ctx.ENVIRON) ctx.specialStoreSizes.set("ENVIRON", size);
}

/**
 * True when the named scalar variable currently holds a numeric
 * string (strnum). Built-in scalars are never strnums.
 */
export function isStrnumVar(ctx: AwkRuntimeContext, name: string): boolean {
  return ctx.strnumVars?.has(name) ?? false;
}

/**
 * Record (or clear) that a scalar variable holds a numeric string.
 * Built-in scalar names are ignored: they are formatted/compared
 * through their own accessors, never through this set.
 */
export function markStrnumVar(
  ctx: AwkRuntimeContext,
  name: string,
  isStrnum: boolean,
): void {
  if (BUILTIN_SCALARS.has(name)) return;
  if (!ctx.strnumVars) ctx.strnumVars = new Set();
  if (isStrnum) ctx.strnumVars.add(name);
  else ctx.strnumVars.delete(name);
}

/**
 * True when an array element (by resolved array name) holds a numeric
 * string (strnum).
 */
export function isStrnumArrayKey(
  ctx: AwkRuntimeContext,
  resolvedName: string,
  key: string,
): boolean {
  return ctx.strnumArrayKeys?.get(resolvedName)?.has(key) ?? false;
}

/**
 * Record (or clear) that an array element holds a numeric string.
 */
export function markStrnumArrayKey(
  ctx: AwkRuntimeContext,
  resolvedName: string,
  key: string,
  isStrnum: boolean,
): void {
  if (!ctx.strnumArrayKeys) ctx.strnumArrayKeys = new Map();
  if (isStrnum) {
    let keys = ctx.strnumArrayKeys.get(resolvedName);
    if (!keys) {
      keys = new Set();
      ctx.strnumArrayKeys.set(resolvedName, keys);
    }
    keys.add(key);
  } else {
    ctx.strnumArrayKeys.get(resolvedName)?.delete(key);
  }
}

/**
 * Replace an array's strnum-key set wholesale (split/asort rebuild
 * the array, so the old keys no longer apply).
 */
export function setStrnumArrayKeys(
  ctx: AwkRuntimeContext,
  resolvedName: string,
  keys: Set<string>,
): void {
  if (!ctx.strnumArrayKeys) ctx.strnumArrayKeys = new Map();
  if (keys.size > 0) ctx.strnumArrayKeys.set(resolvedName, keys);
  else ctx.strnumArrayKeys.delete(resolvedName);
}

/**
 * Drop an array's strnum-key set entirely (whole-array delete/replace
 * with unknown provenance; callers that know the new contents set the
 * keys again afterwards).
 */
export function clearStrnumArray(
  ctx: AwkRuntimeContext,
  resolvedName: string,
): void {
  ctx.strnumArrayKeys?.delete(resolvedName);
}

/**
 * Initial (prepopulated) element count of the store, or 0 for a
 * program-created array. Derived from the store's identity, not the
 * name, so an alias of ARGV/ENVIRON reports the same baseline.
 */
function prepopulatedSize(
  ctx: AwkRuntimeContext,
  store: Record<string, AwkValue>,
): number {
  if (store === ctx.ARGV) return ctx.arrayElementBaselines.get("ARGV") ?? 0;
  if (store === ctx.ENVIRON)
    return ctx.arrayElementBaselines.get("ENVIRON") ?? 0;
  return 0;
}

/**
 * Initial (prepopulated) element count of the array, or 0 for a
 * program-created array.
 */
export function initialSizeOfArray(
  ctx: AwkRuntimeContext,
  rawName: string,
  resolvedName: string,
): number {
  const store = getArrayStore(ctx, rawName, resolvedName);
  if (!store) return 0;
  return prepopulatedSize(ctx, store);
}

/**
 * How many of an array's elements consume the maxArrayElements
 * allowance: its size beyond the prepopulated contents. A regular
 * array's whole size counts; ARGV/ENVIRON count only past their
 * initial sizes, so replacing their prepopulated entries does not
 * consume the allowance. (Residual bound: each prepopulated store can
 * hold up to its initial size in program-added values without charge,
 * so the total user-held elements stay within maxArrayElements plus
 * the prepopulated sizes.)
 */
export function chargedSizeOfArray(
  ctx: AwkRuntimeContext,
  rawName: string,
  resolvedName: string,
): number {
  const store = getArrayStore(ctx, rawName, resolvedName);
  if (!store) return 0;
  return Math.max(
    0,
    specialStoreSize(ctx, store) - prepopulatedSize(ctx, store),
  );
}

/**
 * True when the named variable is an initialized scalar: it holds a
 * scalar value (or is a built-in scalar) and has no array under its
 * alias-resolved name. Uninitialized names are not scalars — built-ins
 * like asort treat them as empty arrays, as before. A name that is
 * both a scalar and an array (possible only after a conflicting
 * assignment) counts as an array here.
 */
const BUILTIN_SCALARS = new Set([
  "FS",
  "OFS",
  "ORS",
  "OFMT",
  "CONVFMT",
  "NR",
  "NF",
  "FNR",
  "FILENAME",
  "RSTART",
  "RLENGTH",
  "SUBSEP",
  "ARGC",
]);

export function isScalarVariable(
  ctx: AwkRuntimeContext,
  name: string,
): boolean {
  const resolved = resolveArrayName(ctx, name);
  if (resolved === "ARGV" || resolved === "ENVIRON") return false;
  if (ctx.arrays[resolved] !== undefined) return false;
  if (BUILTIN_SCALARS.has(resolved)) return true;
  return ctx.vars[resolved] !== undefined;
}

/**
 * Replace an array's contents with the given values, reindexed 1..n.
 * ARGV and ENVIRON are stored outside ctx.arrays; only the values
 * beyond their prepopulated contents are charged to arrayElementCount
 * (their initial sizes are exempt, so a small limit still leaves room
 * for program arrays). Regular arrays go through deleteArray and
 * setArrayElement so the element count stays exact.
 */
export function replaceArrayValues(
  ctx: AwkRuntimeContext,
  rawName: string,
  values: AwkValue[],
  resolvedName: string = resolveArrayName(ctx, rawName),
): void {
  const store = getArrayStore(ctx, rawName, resolvedName);
  if (store !== undefined && (store === ctx.ARGV || store === ctx.ENVIRON)) {
    const oldCharged = chargedSizeOfArray(ctx, rawName, resolvedName);
    const newCharged = Math.max(
      0,
      values.length - prepopulatedSize(ctx, store),
    );
    if (
      ctx.arrayElementCount - oldCharged + newCharged >
      ctx.maxArrayElements
    ) {
      throw new ExecutionLimitError(
        `array element limit exceeded (${ctx.maxArrayElements})`,
        "array_elements",
      );
    }
    for (const key of Object.keys(store)) {
      delete store[key];
    }
    for (let i = 0; i < values.length; i++) {
      store[String(i + 1)] = values[i];
    }
    setSpecialStoreSize(ctx, store, values.length);
    // The incoming values carry no provenance here; callers that know
    // it (asort) set the destination's strnum keys again afterwards.
    clearStrnumArray(ctx, resolvedName);
    // Clamped at zero: a context built without baselines (e.g.
    // hand-built in a test) can otherwise drive the count negative.
    ctx.arrayElementCount = Math.max(
      0,
      ctx.arrayElementCount - oldCharged + newCharged,
    );
    return;
  }
  deleteArray(ctx, resolvedName);
  for (let i = 0; i < values.length; i++) {
    setArrayElement(ctx, resolvedName, String(i + 1), values[i]);
  }
}

/**
 * Get an array element value. The name is resolved through aliases
 * first, so an alias of ARGV or ENVIRON reads the store that built-ins
 * like asort change, instead of a shadow array under the alias name.
 */
export function getArrayElement(
  ctx: AwkRuntimeContext,
  array: string,
  key: string,
): AwkValue {
  const resolvedArray = resolveArrayName(ctx, array);
  const store = getArrayStore(ctx, array, resolvedArray);
  return store?.[key] ?? "";
}

/**
 * Set an array element value. An alias of ARGV or ENVIRON writes the
 * real store (with the element-limit check and count), so a write
 * through a function parameter stays visible to later reads.
 */
export function setArrayElement(
  ctx: AwkRuntimeContext,
  array: string,
  key: string,
  value: AwkValue,
): void {
  // Resolve aliases for function parameter passing
  const resolvedArray = resolveArrayName(ctx, array);
  const store = getArrayStore(ctx, array, resolvedArray);
  if (store !== undefined && (store === ctx.ARGV || store === ctx.ENVIRON)) {
    if (!(key in store)) {
      // Only elements beyond the prepopulated contents consume the
      // allowance: the initial ARGV/ENVIRON entries are exempt, so a
      // small maxArrayElements still leaves room for program arrays.
      // The store size is tracked incrementally (see
      // ctx.specialStoreSizes): rescanning the keys on every insert
      // made filling ARGV/ENVIRON quadratic.
      const size = specialStoreSize(ctx, store);
      if (size >= prepopulatedSize(ctx, store)) {
        if (ctx.arrayElementCount >= ctx.maxArrayElements) {
          throw new ExecutionLimitError(
            `array element limit exceeded (${ctx.maxArrayElements})`,
            "array_elements",
          );
        }
        ctx.arrayElementCount++;
      }
      setSpecialStoreSize(ctx, store, size + 1);
    }
    store[key] = value;
    // The new value carries no provenance at this layer; the
    // assignment evaluator re-marks the key when the right-hand side
    // is a field or a numeric-string variable.
    markStrnumArrayKey(ctx, resolvedArray, key, false);
    return;
  }
  if (!ctx.arrays[resolvedArray]) {
    // Use null-prototype to prevent prototype pollution with user-controlled keys
    ctx.arrays[resolvedArray] = Object.create(null);
  }
  if (!(key in ctx.arrays[resolvedArray])) {
    if (ctx.arrayElementCount >= ctx.maxArrayElements) {
      throw new ExecutionLimitError(
        `array element limit exceeded (${ctx.maxArrayElements})`,
        "array_elements",
      );
    }
    ctx.arrayElementCount++;
  }
  ctx.arrays[resolvedArray][key] = value;
  // As in the special-store branch, the assignment evaluator re-marks
  // the key when the right-hand side carries numeric-string provenance.
  markStrnumArrayKey(ctx, resolvedArray, key, false);
}

/**
 * Check if an array element exists. Resolves aliases first, so an alias
 * of ARGV or ENVIRON checks the real store.
 */
export function hasArrayElement(
  ctx: AwkRuntimeContext,
  array: string,
  key: string,
): boolean {
  const resolvedArray = resolveArrayName(ctx, array);
  const store = getArrayStore(ctx, array, resolvedArray);
  return store?.[key] !== undefined;
}

/**
 * Delete an array element. Resolves aliases first, so deleting through
 * an alias of ARGV or ENVIRON removes the element from the real store
 * and keeps the element count exact.
 */
export function deleteArrayElement(
  ctx: AwkRuntimeContext,
  array: string,
  key: string,
): void {
  // Resolve aliases for function parameter passing
  const resolvedArray = resolveArrayName(ctx, array);
  const store = getArrayStore(ctx, array, resolvedArray);
  if (store !== undefined && (store === ctx.ARGV || store === ctx.ENVIRON)) {
    if (key in store) {
      // Only a charged element frees allowance when deleted: while the
      // store still holds more than its prepopulated size, the deleted
      // key counts as a program-added one.
      const size = specialStoreSize(ctx, store);
      if (size > prepopulatedSize(ctx, store)) {
        ctx.arrayElementCount = Math.max(0, ctx.arrayElementCount - 1);
      }
      delete store[key];
      setSpecialStoreSize(ctx, store, size - 1);
      markStrnumArrayKey(ctx, resolvedArray, key, false);
    }
    return;
  }
  if (ctx.arrays[resolvedArray]) {
    if (key in ctx.arrays[resolvedArray]) ctx.arrayElementCount--;
    delete ctx.arrays[resolvedArray][key];
    markStrnumArrayKey(ctx, resolvedArray, key, false);
  }
}

/**
 * Delete an entire array. Resolves aliases first, so deleting ARGV or
 * ENVIRON (directly or through an alias) clears the real store and
 * keeps the element count exact.
 */
export function deleteArray(ctx: AwkRuntimeContext, array: string): void {
  // Resolve aliases for function parameter passing
  const resolvedArray = resolveArrayName(ctx, array);
  const store = getArrayStore(ctx, array, resolvedArray);
  if (store !== undefined && (store === ctx.ARGV || store === ctx.ENVIRON)) {
    // Only the charged part (beyond the prepopulated contents) frees
    // allowance; deleting prepopulated entries frees none.
    ctx.arrayElementCount = Math.max(
      0,
      ctx.arrayElementCount - chargedSizeOfArray(ctx, array, resolvedArray),
    );
    for (const key of Object.keys(store)) {
      delete store[key];
    }
    setSpecialStoreSize(ctx, store, 0);
    clearStrnumArray(ctx, resolvedArray);
    return;
  }
  ctx.arrayElementCount -= Object.keys(ctx.arrays[resolvedArray] ?? {}).length;
  delete ctx.arrays[resolvedArray];
  clearStrnumArray(ctx, resolvedArray);
}
