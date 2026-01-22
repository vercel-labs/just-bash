/**
 * local - Declare local variables in functions builtin
 */

import type { ExecResult } from "../../types.js";
import { markNameref } from "../helpers/nameref.js";
import { failure, result } from "../helpers/result.js";
import type { InterpreterContext } from "../types.js";
import { parseArrayElements } from "./declare.js";

/**
 * Expand tildes in assignment values (PATH-like expansion)
 * - ~ at start expands to HOME
 * - ~ after : expands to HOME (for PATH-like values)
 * - ~username expands to user's home (only root supported)
 */
function expandTildesInValue(ctx: InterpreterContext, value: string): string {
  const home = ctx.state.env.HOME || "/home/user";

  // Split by : to handle PATH-like values
  const parts = value.split(":");
  const expanded = parts.map((part) => {
    if (part === "~") {
      return home;
    }
    if (part === "~root") {
      return "/root";
    }
    if (part.startsWith("~/")) {
      return home + part.slice(1);
    }
    if (part.startsWith("~root/")) {
      return `/root${part.slice(5)}`;
    }
    // ~otheruser stays literal (can't verify user exists)
    return part;
  });

  return expanded.join(":");
}

export function handleLocal(
  ctx: InterpreterContext,
  args: string[],
): ExecResult {
  if (ctx.state.localScopes.length === 0) {
    return failure("bash: local: can only be used in a function\n");
  }

  const currentScope = ctx.state.localScopes[ctx.state.localScopes.length - 1];
  let stderr = "";
  let exitCode = 0;
  let declareNameref = false;

  // Parse flags
  const processedArgs: string[] = [];
  for (const arg of args) {
    if (arg === "-n") {
      declareNameref = true;
    } else if (arg.startsWith("-") && !arg.includes("=")) {
      // Handle combined flags like -n
      for (const flag of arg.slice(1)) {
        if (flag === "n") declareNameref = true;
        // Other flags are ignored for now
      }
    } else {
      processedArgs.push(arg);
    }
  }

  for (const arg of processedArgs) {
    let name: string;
    let value: string | undefined;

    // Check for array assignment: name=(...)
    const arrayMatch = arg.match(/^([a-zA-Z_][a-zA-Z0-9_]*)=\((.*)\)$/s);
    if (arrayMatch) {
      name = arrayMatch[1];
      const content = arrayMatch[2];

      // Validate variable name
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
        stderr += `bash: local: \`${arg}': not a valid identifier\n`;
        exitCode = 1;
        continue;
      }

      // Save previous value for scope restoration
      if (!currentScope.has(name)) {
        currentScope.set(name, ctx.state.env[name]);
        // Also save array elements
        const prefix = `${name}_`;
        for (const key of Object.keys(ctx.state.env)) {
          if (key.startsWith(prefix) && !key.includes("__")) {
            if (!currentScope.has(key)) {
              currentScope.set(key, ctx.state.env[key]);
            }
          }
        }
      }

      // Clear existing array elements
      const prefix = `${name}_`;
      for (const key of Object.keys(ctx.state.env)) {
        if (key.startsWith(prefix) && !key.includes("__")) {
          delete ctx.state.env[key];
        }
      }

      // Parse array elements (respects quotes)
      const elements = parseArrayElements(content);
      for (let i = 0; i < elements.length; i++) {
        ctx.state.env[`${name}_${i}`] = elements[i];
      }
      ctx.state.env[`${name}__length`] = String(elements.length);

      // Mark as nameref if -n flag was used
      if (declareNameref) {
        markNameref(ctx, name);
      }
      continue;
    }

    if (arg.includes("=")) {
      const eqIdx = arg.indexOf("=");
      name = arg.slice(0, eqIdx);
      value = expandTildesInValue(ctx, arg.slice(eqIdx + 1));
    } else {
      name = arg;
    }

    // Validate variable name: must start with letter/underscore, contain only alphanumeric/_
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
      stderr += `bash: local: \`${arg}': not a valid identifier\n`;
      exitCode = 1;
      continue;
    }

    if (!currentScope.has(name)) {
      currentScope.set(name, ctx.state.env[name]);
    }
    if (value !== undefined) {
      ctx.state.env[name] = value;
    }

    // Mark as nameref if -n flag was used
    if (declareNameref) {
      markNameref(ctx, name);
    }
  }

  return result("", stderr, exitCode);
}
