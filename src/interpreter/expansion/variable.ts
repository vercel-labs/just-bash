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
import { BASH_VERSION, getProcessInfo } from "../../shell-metadata.js";
import { evaluateArithmeticSync } from "../arithmetic.js";
import { BadSubstitutionError, NounsetError } from "../errors.js";
import {
  getArrayIndices,
  getAssocArrayKeys,
  unquoteKey,
} from "../helpers/array.js";
import { getIfsSeparator } from "../helpers/ifs.js";
import type { InterpreterContext } from "../types.js";

/**
 * Get all elements of an array stored as arrayName_0, arrayName_1, etc.
 * Returns an array of [index/key, value] tuples, sorted by index/key.
 * For associative arrays, uses string keys.
 */
export function getArrayElements(
  ctx: InterpreterContext,
  arrayName: string,
): Array<[number | string, string]> {
  const isAssoc = ctx.state.associativeArrays?.has(arrayName);

  if (isAssoc) {
    // For associative arrays, get string keys
    const keys = getAssocArrayKeys(ctx, arrayName);
    return keys.map((key) => [key, ctx.state.env[`${arrayName}_${key}`]]);
  }

  // For indexed arrays, get numeric indices
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
  // Check if it's an associative array
  if (ctx.state.associativeArrays?.has(name)) {
    return getAssocArrayKeys(ctx, name).length > 0;
  }
  // Check for indexed array elements
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
    case "_":
      // $_ is the last argument of the previous command
      return ctx.state.lastArg;
    case "-": {
      // $- returns current shell option flags
      let flags = "";
      if (ctx.state.options.errexit) flags += "e";
      if (ctx.state.options.nounset) flags += "u";
      if (ctx.state.options.verbose) flags += "v";
      if (ctx.state.options.xtrace) flags += "x";
      if (ctx.state.options.pipefail) flags += "p";
      return flags;
    }
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
      return params.join(getIfsSeparator(ctx.state.env));
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
    case "PPID": {
      // Parent process ID (from shared metadata)
      const { ppid } = getProcessInfo();
      return String(ppid);
    }
    case "UID": {
      // Real user ID (from shared metadata)
      const { uid } = getProcessInfo();
      return String(uid);
    }
    case "EUID":
      // Effective user ID (same as UID in our simulated environment)
      return String(process.geteuid?.() ?? getProcessInfo().uid);
    case "RANDOM":
      // Random number between 0 and 32767
      return String(Math.floor(Math.random() * 32768));
    case "SECONDS":
      // Seconds since shell started
      return String(Math.floor((Date.now() - ctx.state.startTime) / 1000));
    case "BASH_VERSION":
      // Simulated bash version (from shared metadata)
      return BASH_VERSION;
    case "!":
      // PID of most recent background job (0 if none)
      return String(ctx.state.lastBackgroundPid);
    case "LINENO":
      // Current line number being executed
      return String(ctx.state.currentLine);
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

    const isAssoc = ctx.state.associativeArrays?.has(arrayName);

    if (isAssoc) {
      // For associative arrays, use subscript as string key (remove quotes if present)
      const key = unquoteKey(subscript);
      const value = ctx.state.env[`${arrayName}_${key}`];
      if (value === undefined && checkNounset && ctx.state.options.nounset) {
        throw new NounsetError(`${arrayName}[${subscript}]`);
      }
      return value || "";
    }

    // Evaluate subscript as arithmetic expression for indexed arrays
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

    // Handle negative indices - bash counts from max_index + 1
    // So a[-1] = a[max_index], a[-2] = a[max_index - 1], etc.
    if (index < 0) {
      const elements = getArrayElements(ctx, arrayName);
      if (elements.length === 0) {
        // Empty array with negative index - output error to stderr and return empty
        ctx.state.expansionStderr =
          (ctx.state.expansionStderr || "") +
          `bash: ${arrayName}: bad array subscript\n`;
        return "";
      }
      // Find the maximum index
      const maxIndex = Math.max(
        ...elements.map(([idx]) => (typeof idx === "number" ? idx : 0)),
      );
      // Convert negative index to actual index
      const actualIdx = maxIndex + 1 + index;
      if (actualIdx < 0) {
        // Out of bounds negative index - output error to stderr and return empty
        ctx.state.expansionStderr =
          (ctx.state.expansionStderr || "") +
          `bash: ${arrayName}: bad array subscript\n`;
        return "";
      }
      // Look up by actual index, not position
      const value = ctx.state.env[`${arrayName}_${actualIdx}`];
      return value || "";
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
