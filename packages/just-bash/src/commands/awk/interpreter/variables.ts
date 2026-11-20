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
  }

  ctx.vars[name] = value;
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
 * Replace an array's contents with the given values, reindexed 1..n.
 * ARGV and ENVIRON are stored outside ctx.arrays; their elements count
 * toward arrayElementCount like any other array, so copying values into
 * them checks the element limit first and adjusts the count by the size
 * change. Regular arrays go through deleteArray and setArrayElement so
 * the element count stays exact.
 */
export function replaceArrayValues(
  ctx: AwkRuntimeContext,
  rawName: string,
  values: AwkValue[],
  resolvedName: string = resolveArrayName(ctx, rawName),
): void {
  const store = getArrayStore(ctx, rawName, resolvedName);
  if (store !== undefined && (store === ctx.ARGV || store === ctx.ENVIRON)) {
    const oldSize = Object.keys(store).length;
    if (
      ctx.arrayElementCount - oldSize + values.length >
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
    // Clamped at zero: a context built without counting ARGV/ENVIRON
    // (e.g. hand-built in a test) can otherwise drive the count negative.
    ctx.arrayElementCount = Math.max(
      0,
      ctx.arrayElementCount - oldSize + values.length,
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
      if (ctx.arrayElementCount >= ctx.maxArrayElements) {
        throw new ExecutionLimitError(
          `array element limit exceeded (${ctx.maxArrayElements})`,
          "array_elements",
        );
      }
      ctx.arrayElementCount++;
    }
    store[key] = value;
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
      ctx.arrayElementCount--;
      delete store[key];
    }
    return;
  }
  if (ctx.arrays[resolvedArray]) {
    if (key in ctx.arrays[resolvedArray]) ctx.arrayElementCount--;
    delete ctx.arrays[resolvedArray][key];
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
    ctx.arrayElementCount -= Object.keys(store).length;
    for (const key of Object.keys(store)) {
      delete store[key];
    }
    return;
  }
  ctx.arrayElementCount -= Object.keys(ctx.arrays[resolvedArray] ?? {}).length;
  delete ctx.arrays[resolvedArray];
}
