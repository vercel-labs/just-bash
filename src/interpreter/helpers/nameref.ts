/**
 * Nameref (declare -n) support
 *
 * Namerefs are variables that reference other variables by name.
 * When a nameref is accessed, it transparently dereferences to the target variable.
 */

import type { InterpreterContext } from "../types.js";

/**
 * Check if a variable is a nameref
 */
export function isNameref(ctx: InterpreterContext, name: string): boolean {
  return ctx.state.namerefs?.has(name) ?? false;
}

/**
 * Mark a variable as a nameref
 */
export function markNameref(ctx: InterpreterContext, name: string): void {
  ctx.state.namerefs ??= new Set();
  ctx.state.namerefs.add(name);
}

/**
 * Remove the nameref attribute from a variable
 */
export function unmarkNameref(ctx: InterpreterContext, name: string): void {
  ctx.state.namerefs?.delete(name);
}

/**
 * Check if a name refers to a valid, existing variable or array element.
 * Used to determine if a nameref target is "real" or just a stored value.
 */
function targetExists(ctx: InterpreterContext, target: string): boolean {
  // Check for array subscript
  const arrayMatch = target.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\[(.+)\]$/);
  if (arrayMatch) {
    const arrayName = arrayMatch[1];
    // Check if array exists (has any elements or is declared as assoc)
    const hasElements = Object.keys(ctx.state.env).some(
      (k) => k.startsWith(`${arrayName}_`) && !k.includes("__"),
    );
    const isAssoc = ctx.state.associativeArrays?.has(arrayName) ?? false;
    return hasElements || isAssoc;
  }

  // Check if it's an array (stored as target_0, target_1, etc.)
  const hasArrayElements = Object.keys(ctx.state.env).some(
    (k) => k.startsWith(`${target}_`) && !k.includes("__"),
  );
  if (hasArrayElements) {
    return true;
  }

  // Check if scalar variable exists
  return ctx.state.env[target] !== undefined;
}

/**
 * Resolve a nameref chain to the final variable name.
 * Returns the original name if it's not a nameref.
 * Detects circular references and returns undefined.
 *
 * @param ctx - The interpreter context
 * @param name - The variable name to resolve
 * @param maxDepth - Maximum chain depth to prevent infinite loops (default 100)
 * @returns The resolved variable name, or undefined if circular reference detected
 */
export function resolveNameref(
  ctx: InterpreterContext,
  name: string,
  maxDepth = 100,
): string | undefined {
  // If not a nameref, return as-is
  if (!isNameref(ctx, name)) {
    return name;
  }

  const seen = new Set<string>();
  let current = name;

  while (maxDepth-- > 0) {
    // Detect circular reference
    if (seen.has(current)) {
      return undefined;
    }
    seen.add(current);

    // If not a nameref, we've reached the target
    if (!isNameref(ctx, current)) {
      return current;
    }

    // Get the target name from the variable's value
    const target = ctx.state.env[current];
    if (target === undefined || target === "") {
      // Empty or unset nameref - return the nameref itself
      return current;
    }

    // Validate target is a valid variable name (not special chars like #, @, *, etc.)
    // Allow array subscripts like arr[0] or arr[@]
    // Note: Numeric-only targets like '1' are NOT valid - bash doesn't resolve namerefs
    // to positional parameters. The nameref keeps its literal value.
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*(\[.+\])?$/.test(target)) {
      // Invalid nameref target - return the nameref itself (bash behavior)
      return current;
    }

    // Check if target exists - if not and it's not another nameref, return current
    // This handles the case where a nameref was declared with an invalid target (like '1'),
    // then later assigned a valid-looking name (like 'foo') that doesn't exist as a variable.
    // In bash, such a nameref acts like a regular variable.
    if (!isNameref(ctx, target) && !targetExists(ctx, target)) {
      return current;
    }

    current = target;
  }

  // Max depth exceeded - likely circular reference
  return undefined;
}

/**
 * Get the target name of a nameref (what it points to).
 * Returns the variable's value if it's a nameref, undefined otherwise.
 */
export function getNamerefTarget(
  ctx: InterpreterContext,
  name: string,
): string | undefined {
  if (!isNameref(ctx, name)) {
    return undefined;
  }
  return ctx.state.env[name];
}
