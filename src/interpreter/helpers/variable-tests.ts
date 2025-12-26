import type { InterpreterContext } from "../types.js";

/**
 * Evaluates the -v (variable is set) test.
 * Handles both simple variables and array element access with negative indices.
 *
 * @param ctx - Interpreter context with environment variables
 * @param operand - The variable name to test, may include array subscript (e.g., "arr[0]", "arr[-1]")
 */
export function evaluateVariableTest(
  ctx: InterpreterContext,
  operand: string,
): boolean {
  // Check for array element syntax: var[index]
  const arrayMatch = operand.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\[(.+)\]$/);

  if (arrayMatch) {
    const arrayName = arrayMatch[1];
    let indexExpr = arrayMatch[2];

    // Expand variables in index
    indexExpr = indexExpr.replace(
      /\$([a-zA-Z_][a-zA-Z0-9_]*)/g,
      (_, varName) => {
        return ctx.state.env[varName] || "";
      },
    );

    // Evaluate as arithmetic or number
    let index: number;
    if (/^-?\d+$/.test(indexExpr)) {
      index = Number.parseInt(indexExpr, 10);
    } else {
      // Try to evaluate as arithmetic expression
      try {
        const result = Function(`"use strict"; return (${indexExpr})`)();
        index = typeof result === "number" ? Math.floor(result) : 0;
      } catch {
        const varValue = ctx.state.env[indexExpr];
        index = varValue ? Number.parseInt(varValue, 10) : 0;
      }
    }

    // Handle negative indices - convert to actual index
    if (index < 0) {
      const prefix = `${arrayName}_`;
      const indices: number[] = [];
      for (const key of Object.keys(ctx.state.env)) {
        if (key.startsWith(prefix)) {
          const idx = Number.parseInt(key.slice(prefix.length), 10);
          if (!Number.isNaN(idx)) indices.push(idx);
        }
      }
      indices.sort((a, b) => a - b);
      const actualIdx = indices.length + index;
      if (actualIdx < 0 || actualIdx >= indices.length) {
        return false;
      }
      index = indices[actualIdx];
    }

    return `${arrayName}_${index}` in ctx.state.env;
  }

  return operand in ctx.state.env;
}
