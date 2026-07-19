/**
 * Variable Attributes
 *
 * Functions for getting variable attributes (${var@a} transformation).
 */

import { getArray } from "../helpers/array.js";
import { isNameref } from "../helpers/nameref.js";
import { isReadonly } from "../helpers/readonly.js";
import type { InterpreterContext } from "../types.js";

/**
 * Get the attributes of a variable for ${var@a} transformation.
 * Returns a string with attribute flags (e.g., "ar" for readonly array).
 *
 * Attribute flags (in order):
 * - a: indexed array
 * - A: associative array
 * - i: integer
 * - n: nameref
 * - r: readonly
 * - x: exported
 */
export function getVariableAttributes(
  ctx: InterpreterContext,
  name: string,
): string {
  // Handle special variables (like ?, $, etc.) - they have no attributes
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    return "";
  }

  let attrs = "";

  // Check the structured array kind.
  const isIndexedArray = getArray(ctx, name)?.kind === "indexed";

  // Check for associative array
  const isAssocArray = ctx.state.associativeArrays?.has(name) ?? false;

  // Add array attributes (indexed before associative)
  if (isIndexedArray && !isAssocArray) {
    attrs += "a";
  }
  if (isAssocArray) {
    attrs += "A";
  }

  // Check for integer attribute
  if (ctx.state.integerVars?.has(name)) {
    attrs += "i";
  }

  // Check for nameref attribute
  if (isNameref(ctx, name)) {
    attrs += "n";
  }

  // Check for readonly attribute
  if (isReadonly(ctx, name)) {
    attrs += "r";
  }

  // Check for exported attribute
  if (ctx.state.exportedVars?.has(name)) {
    attrs += "x";
  }

  return attrs;
}
