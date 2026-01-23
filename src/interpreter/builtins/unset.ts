/**
 * unset - Remove variables/functions builtin
 *
 * Supports:
 * - unset VAR - remove variable
 * - unset -v VAR - remove variable (explicit)
 * - unset -f FUNC - remove function
 * - unset 'a[i]' - remove array element (with arithmetic index support)
 *
 * Bash-specific unset scoping:
 * - local-unset (same scope): value-unset - clears value but keeps local cell
 * - dynamic-unset (different scope): cell-unset - removes local cell, exposes outer value
 */

import type { ExecResult } from "../../types.js";
import { getArrayElements } from "../expansion.js";
import { isNameref, resolveNameref } from "../helpers/nameref.js";
import { isReadonly } from "../helpers/readonly.js";
import { result } from "../helpers/result.js";
import type { InterpreterContext } from "../types.js";
import { clearLocalVarDepth, getLocalVarDepth } from "./variable-helpers.js";

/**
 * Perform cell-unset for a local variable (dynamic-unset).
 * This removes the local cell and exposes the outer scope's value.
 * Returns true if a cell-unset was performed, false otherwise.
 */
function performCellUnset(ctx: InterpreterContext, varName: string): boolean {
  // Find the scope where this variable was declared
  // Search from innermost scope outward
  for (let i = ctx.state.localScopes.length - 1; i >= 0; i--) {
    const scope = ctx.state.localScopes[i];
    if (scope.has(varName)) {
      // Found the scope - restore the outer value
      const outerValue = scope.get(varName);
      if (outerValue === undefined) {
        delete ctx.state.env[varName];
      } else {
        ctx.state.env[varName] = outerValue;
      }
      // Remove from this scope so future lookups find the outer value
      scope.delete(varName);
      // Clear the local variable depth tracking
      clearLocalVarDepth(ctx, varName);
      return true;
    }
  }
  return false;
}

export function handleUnset(
  ctx: InterpreterContext,
  args: string[],
): ExecResult {
  let mode: "variable" | "function" | "both" = "both"; // Default: unset both var and func
  let stderr = "";
  let exitCode = 0;

  for (const arg of args) {
    // Handle flags
    if (arg === "-v") {
      mode = "variable"; // Explicit: only variable
      continue;
    }
    if (arg === "-f") {
      mode = "function";
      continue;
    }

    if (mode === "function") {
      ctx.state.functions.delete(arg);
      continue;
    }

    // If mode is "variable", only delete variables, not functions
    if (mode === "variable") {
      // Handle array element syntax: varName[index]
      const arrayMatchVar = arg.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\[(.+)\]$/);
      if (arrayMatchVar) {
        const arrayName = arrayMatchVar[1];
        const indexExpr = arrayMatchVar[2];

        if (indexExpr === "@" || indexExpr === "*") {
          const elements = getArrayElements(ctx, arrayName);
          for (const [idx] of elements) {
            delete ctx.state.env[`${arrayName}_${idx}`];
          }
          delete ctx.state.env[arrayName];
          continue;
        }

        let index: number;
        if (/^-?\d+$/.test(indexExpr)) {
          index = Number.parseInt(indexExpr, 10);
        } else {
          const evalValue = ctx.state.env[indexExpr];
          index = evalValue ? Number.parseInt(evalValue, 10) : 0;
          if (Number.isNaN(index)) index = 0;
        }

        if (index < 0) {
          const elements = getArrayElements(ctx, arrayName);
          const len = elements.length;
          const lineNum = ctx.state.currentLine;
          if (len === 0) {
            stderr += `bash: line ${lineNum}: unset: [${index}]: bad array subscript\n`;
            exitCode = 1;
            continue;
          }
          const actualPos = len + index;
          if (actualPos < 0) {
            stderr += `bash: line ${lineNum}: unset: [${index}]: bad array subscript\n`;
            exitCode = 1;
            continue;
          }
          const actualIndex = elements[actualPos][0];
          delete ctx.state.env[`${arrayName}_${actualIndex}`];
          continue;
        }

        delete ctx.state.env[`${arrayName}_${index}`];
        continue;
      }

      // Regular variable with -v: only delete variable, NOT function
      let targetName = arg;
      if (isNameref(ctx, arg)) {
        const resolved = resolveNameref(ctx, arg);
        if (resolved && resolved !== arg) {
          targetName = resolved;
        }
      }

      // Check if variable is readonly
      if (isReadonly(ctx, targetName)) {
        stderr += `bash: unset: ${targetName}: cannot unset: readonly variable\n`;
        exitCode = 1;
        continue;
      }

      // Bash-specific unset scoping: check if this is a dynamic-unset
      const localDepth = getLocalVarDepth(ctx, targetName);
      if (localDepth !== undefined && localDepth !== ctx.state.callDepth) {
        // Dynamic-unset: called from a different scope than where local was declared
        // Perform cell-unset to expose outer value
        performCellUnset(ctx, targetName);
      } else {
        // Local-unset or not a local variable: just delete the value
        delete ctx.state.env[targetName];
      }
      continue;
    }

    // Check for array element syntax: varName[index]
    const arrayMatch = arg.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\[(.+)\]$/);
    if (arrayMatch) {
      const arrayName = arrayMatch[1];
      const indexExpr = arrayMatch[2];

      // Handle [@] or [*] - unset entire array
      if (indexExpr === "@" || indexExpr === "*") {
        const elements = getArrayElements(ctx, arrayName);
        for (const [idx] of elements) {
          delete ctx.state.env[`${arrayName}_${idx}`];
        }
        delete ctx.state.env[arrayName];
        continue;
      }

      // Evaluate index as arithmetic expression
      let index: number;
      if (/^-?\d+$/.test(indexExpr)) {
        index = Number.parseInt(indexExpr, 10);
      } else {
        // Try to evaluate as variable or expression
        const evalValue = ctx.state.env[indexExpr];
        index = evalValue ? Number.parseInt(evalValue, 10) : 0;
        if (Number.isNaN(index)) index = 0;
      }

      // Handle negative indices
      if (index < 0) {
        const elements = getArrayElements(ctx, arrayName);
        const len = elements.length;
        const lineNum = ctx.state.currentLine;
        if (len === 0) {
          // Empty array with negative index - error
          stderr += `bash: line ${lineNum}: unset: [${index}]: bad array subscript\n`;
          exitCode = 1;
          continue;
        }
        // Convert negative index to actual position in sparse array
        const actualPos = len + index;
        if (actualPos < 0) {
          // Out of bounds negative index - error
          stderr += `bash: line ${lineNum}: unset: [${index}]: bad array subscript\n`;
          exitCode = 1;
          continue;
        }
        // Get the actual index from the sorted elements
        const actualIndex = elements[actualPos][0];
        delete ctx.state.env[`${arrayName}_${actualIndex}`];
        continue;
      }

      // Positive index - just delete directly
      delete ctx.state.env[`${arrayName}_${index}`];
      continue;
    }

    // Regular variable - check if it's a nameref and unset the target
    let targetName = arg;
    if (isNameref(ctx, arg)) {
      const resolved = resolveNameref(ctx, arg);
      if (resolved && resolved !== arg) {
        targetName = resolved;
      }
    }

    // Check if variable is readonly
    if (isReadonly(ctx, targetName)) {
      stderr += `bash: unset: ${targetName}: cannot unset: readonly variable\n`;
      exitCode = 1;
      continue;
    }

    // Bash-specific unset scoping: check if this is a dynamic-unset
    const localDepth = getLocalVarDepth(ctx, targetName);
    if (localDepth !== undefined && localDepth !== ctx.state.callDepth) {
      // Dynamic-unset: called from a different scope than where local was declared
      // Perform cell-unset to expose outer value
      performCellUnset(ctx, targetName);
    } else {
      // Local-unset or not a local variable: just delete the value
      delete ctx.state.env[targetName];
    }
    ctx.state.functions.delete(arg);
  }
  return result("", stderr, exitCode);
}
