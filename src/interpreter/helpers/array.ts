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
