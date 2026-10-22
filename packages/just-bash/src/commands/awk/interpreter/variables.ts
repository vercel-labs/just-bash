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
function resolveArrayName(ctx: AwkRuntimeContext, array: string): string {
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

export function getArrayLength(
  ctx: AwkRuntimeContext,
  name: string,
): number | undefined {
  const resolved = resolveArrayName(ctx, name);
  if (
    ctx.arrayAliases.has(resolved) &&
    ctx.arrayAliases.get(resolved) === undefined
  ) {
    return undefined;
  }
  const array =
    resolved === "ARGV"
      ? ctx.ARGV
      : resolved === "ENVIRON"
        ? ctx.ENVIRON
        : ctx.arrays[resolved];
  return array === undefined ? undefined : Object.keys(array).length;
}

/**
 * Get an array element value.
 */
export function getArrayElement(
  ctx: AwkRuntimeContext,
  array: string,
  key: string,
): AwkValue {
  // Handle built-in ARGV array
  if (array === "ARGV") {
    return ctx.ARGV[key] ?? "";
  }
  // Handle built-in ENVIRON array
  if (array === "ENVIRON") {
    return ctx.ENVIRON[key] ?? "";
  }
  // Resolve aliases for function parameter passing
  const resolvedArray = resolveArrayName(ctx, array);
  return ctx.arrays[resolvedArray]?.[key] ?? "";
}

/**
 * Set an array element value.
 */
export function setArrayElement(
  ctx: AwkRuntimeContext,
  array: string,
  key: string,
  value: AwkValue,
): void {
  // Resolve aliases for function parameter passing
  const resolvedArray = resolveArrayName(ctx, array);
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
 * Check if an array element exists.
 */
export function hasArrayElement(
  ctx: AwkRuntimeContext,
  array: string,
  key: string,
): boolean {
  if (array === "ARGV") {
    return ctx.ARGV[key] !== undefined;
  }
  if (array === "ENVIRON") {
    return ctx.ENVIRON[key] !== undefined;
  }
  // Resolve aliases for function parameter passing
  const resolvedArray = resolveArrayName(ctx, array);
  return ctx.arrays[resolvedArray]?.[key] !== undefined;
}

/**
 * Delete an array element.
 */
export function deleteArrayElement(
  ctx: AwkRuntimeContext,
  array: string,
  key: string,
): void {
  // Resolve aliases for function parameter passing
  const resolvedArray = resolveArrayName(ctx, array);
  if (ctx.arrays[resolvedArray]) {
    if (key in ctx.arrays[resolvedArray]) ctx.arrayElementCount--;
    delete ctx.arrays[resolvedArray][key];
  }
}

/**
 * Delete an entire array.
 */
export function deleteArray(ctx: AwkRuntimeContext, array: string): void {
  // Resolve aliases for function parameter passing
  const resolvedArray = resolveArrayName(ctx, array);
  ctx.arrayElementCount -= Object.keys(ctx.arrays[resolvedArray] ?? {}).length;
  delete ctx.arrays[resolvedArray];
}
