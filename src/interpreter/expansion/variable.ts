/**
 * Variable Access
 *
 * Handles variable value retrieval, including:
 * - Special variables ($?, $$, $#, $@, $*, $0)
 * - Array access (${arr[0]}, ${arr[@]}, ${arr[*]})
 * - Positional parameters ($1, $2, ...)
 * - Regular variables
 */

import { parseArithmeticExpression } from "../../parser/arithmetic-parser.js";
import { Parser } from "../../parser/parser.js";
import { evaluateArithmeticSync } from "../arithmetic.js";
import { BadSubstitutionError, NounsetError } from "../errors.js";
import { getArrayIndices } from "../helpers/array.js";
import type { InterpreterContext } from "../types.js";

/**
 * Get all elements of an array stored as arrayName_0, arrayName_1, etc.
 * Returns an array of [index, value] tuples, sorted by index.
 */
export function getArrayElements(
  ctx: InterpreterContext,
  arrayName: string,
): Array<[number, string]> {
  const indices = getArrayIndices(ctx, arrayName);
  return indices.map((index) => [
    index,
    ctx.state.env[`${arrayName}_${index}`],
  ]);
}

/**
 * Check if a variable is an array (has elements stored as name_0, name_1, etc.)
 */
export function isArray(ctx: InterpreterContext, name: string): boolean {
  return getArrayIndices(ctx, name).length > 0;
}

/**
 * Get the value of a variable, optionally checking nounset.
 * @param ctx - The interpreter context
 * @param name - The variable name
 * @param checkNounset - Whether to check for nounset (default true)
 */
export function getVariable(
  ctx: InterpreterContext,
  name: string,
  checkNounset = true,
  _insideDoubleQuotes = false,
): string {
  // Special variables are always defined (never trigger nounset)
  switch (name) {
    case "?":
      return String(ctx.state.lastExitCode);
    case "$":
      return String(process.pid);
    case "#":
      return ctx.state.env["#"] || "0";
    case "@":
      return ctx.state.env["@"] || "";
    case "*": {
      // $* uses first character of IFS as separator when inside double quotes
      // When IFS is empty string, no separator is used
      // When IFS is unset, space is used (default behavior)
      const numParams = Number.parseInt(ctx.state.env["#"] || "0", 10);
      if (numParams === 0) return "";
      const params: string[] = [];
      for (let i = 1; i <= numParams; i++) {
        params.push(ctx.state.env[String(i)] || "");
      }
      // Get separator from IFS
      const ifs = ctx.state.env.IFS;
      const separator = ifs === undefined ? " " : ifs[0] || "";
      return params.join(separator);
    }
    case "0":
      return ctx.state.env["0"] || "bash";
    case "PWD":
      // Check if PWD is in env (might have been unset)
      if (ctx.state.env.PWD !== undefined) {
        return ctx.state.env.PWD;
      }
      // PWD was unset, return empty string
      return "";
    case "OLDPWD":
      // Check if OLDPWD is in env (might have been unset)
      if (ctx.state.env.OLDPWD !== undefined) {
        return ctx.state.env.OLDPWD;
      }
      return "";
  }

  // Check for empty subscript: varName[] is invalid
  if (/^[a-zA-Z_][a-zA-Z0-9_]*\[\]$/.test(name)) {
    throw new BadSubstitutionError(`\${${name}}`);
  }

  // Check for array subscript: varName[subscript]
  const bracketMatch = name.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\[(.+)\]$/);
  if (bracketMatch) {
    const arrayName = bracketMatch[1];
    const subscript = bracketMatch[2];

    if (subscript === "@" || subscript === "*") {
      // Get all array elements joined with space
      const elements = getArrayElements(ctx, arrayName);
      if (elements.length > 0) {
        return elements.map(([, v]) => v).join(" ");
      }
      // If no array elements, treat scalar variable as single-element array
      // ${s[@]} where s='abc' returns 'abc'
      const scalarValue = ctx.state.env[arrayName];
      if (scalarValue !== undefined) {
        return scalarValue;
      }
      return "";
    }

    // Evaluate subscript as arithmetic expression
    // This handles: a[0], a[x], a[x+1], a[a[0]], a[b=2], etc.
    let index: number;
    if (/^-?\d+$/.test(subscript)) {
      // Simple numeric subscript - no need for full arithmetic parsing
      index = Number.parseInt(subscript, 10);
    } else {
      // Parse and evaluate as arithmetic expression
      try {
        const parser = new Parser();
        const arithAst = parseArithmeticExpression(parser, subscript);
        index = evaluateArithmeticSync(ctx, arithAst.expression);
      } catch {
        // Fall back to simple variable lookup for backwards compatibility
        const evalValue = ctx.state.env[subscript];
        index = evalValue ? Number.parseInt(evalValue, 10) : 0;
        if (Number.isNaN(index)) index = 0;
      }
    }

    // Handle negative indices
    if (index < 0) {
      const elements = getArrayElements(ctx, arrayName);
      const len = elements.length;
      if (len === 0) return "";
      // Negative index counts from end
      const actualIdx = len + index;
      if (actualIdx < 0) return "";
      // Find element at that position in the sorted array
      if (actualIdx < elements.length) {
        return elements[actualIdx][1];
      }
      return "";
    }

    const value = ctx.state.env[`${arrayName}_${index}`];
    if (value === undefined && checkNounset && ctx.state.options.nounset) {
      throw new NounsetError(`${arrayName}[${index}]`);
    }
    return value || "";
  }

  // Positional parameters ($1, $2, etc.) - check nounset
  if (/^[1-9][0-9]*$/.test(name)) {
    const value = ctx.state.env[name];
    if (value === undefined && checkNounset && ctx.state.options.nounset) {
      throw new NounsetError(name);
    }
    return value || "";
  }

  // Regular variables - check nounset
  const value = ctx.state.env[name];
  if (value === undefined && checkNounset && ctx.state.options.nounset) {
    throw new NounsetError(name);
  }
  return value || "";
}
