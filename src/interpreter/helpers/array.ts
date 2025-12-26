/**
 * Array helper functions for the interpreter.
 */

import type { InterpreterContext } from "../types.js";

/**
 * Get all indices of an array, sorted in ascending order.
 * Arrays are stored as `name_0`, `name_1`, etc. in the environment.
 */
export function getArrayIndices(
  ctx: InterpreterContext,
  arrayName: string,
): number[] {
  const prefix = `${arrayName}_`;
  const indices: number[] = [];

  for (const key of Object.keys(ctx.state.env)) {
    if (key.startsWith(prefix)) {
      const indexStr = key.slice(prefix.length);
      const index = Number.parseInt(indexStr, 10);
      // Only include numeric indices (not __length or other metadata)
      if (!Number.isNaN(index) && String(index) === indexStr) {
        indices.push(index);
      }
    }
  }

  return indices.sort((a, b) => a - b);
}

/**
 * Clear all elements of an array from the environment.
 */
export function clearArray(ctx: InterpreterContext, arrayName: string): void {
  const prefix = `${arrayName}_`;
  for (const key of Object.keys(ctx.state.env)) {
    if (key.startsWith(prefix)) {
      delete ctx.state.env[key];
    }
  }
}

/**
 * Check if an array is associative (declared with -A).
 */
export function isAssociativeArray(
  ctx: InterpreterContext,
  name: string,
): boolean {
  return ctx.state.associativeArrays?.has(name) ?? false;
}

/**
 * Get all keys of an associative array.
 * For associative arrays, keys are stored as `name_key` where key is a string.
 */
export function getAssocArrayKeys(
  ctx: InterpreterContext,
  arrayName: string,
): string[] {
  const prefix = `${arrayName}_`;
  const keys: string[] = [];

  for (const envKey of Object.keys(ctx.state.env)) {
    if (envKey.startsWith(prefix) && !envKey.includes("__")) {
      const key = envKey.slice(prefix.length);
      keys.push(key);
    }
  }

  return keys.sort();
}

/**
 * Remove surrounding quotes from a key string.
 * Handles 'key' and "key" → key
 */
export function unquoteKey(key: string): string {
  if (
    (key.startsWith("'") && key.endsWith("'")) ||
    (key.startsWith('"') && key.endsWith('"'))
  ) {
    return key.slice(1, -1);
  }
  return key;
}
