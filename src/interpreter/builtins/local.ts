/**
 * local - Declare local variables in functions builtin
 */

import { parseArithmeticExpression } from "../../parser/arithmetic-parser.js";
import { Parser } from "../../parser/parser.js";
import type { ExecResult } from "../../types.js";
import { evaluateArithmeticSync } from "../arithmetic.js";
import { markNameref } from "../helpers/nameref.js";
import { failure, result } from "../helpers/result.js";
import { expandTildesInValue } from "../helpers/tilde.js";
import type { InterpreterContext } from "../types.js";
import { parseArrayElements } from "./declare.js";
import { markLocalVarDepth } from "./variable-helpers.js";

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
  let declareArray = false;
  let printMode = false;

  // Parse flags
  const processedArgs: string[] = [];
  for (const arg of args) {
    if (arg === "-n") {
      declareNameref = true;
    } else if (arg === "-a") {
      declareArray = true;
    } else if (arg === "-p") {
      printMode = true;
    } else if (arg.startsWith("-") && !arg.includes("=")) {
      // Handle combined flags like -na
      for (const flag of arg.slice(1)) {
        if (flag === "n") declareNameref = true;
        else if (flag === "a") declareArray = true;
        else if (flag === "p") printMode = true;
        // Other flags are ignored for now
      }
    } else {
      processedArgs.push(arg);
    }
  }

  // Handle local -p: print local variables in current scope
  // Note: bash outputs local -p without "declare --" prefix, just "name=value"
  if (printMode && processedArgs.length === 0) {
    let stdout = "";
    // Get the names of local variables in current scope
    const localNames = Array.from(currentScope.keys())
      .filter((key) => !key.includes("_") || !key.match(/_\d+$/)) // Filter out array element keys
      .filter((key) => !key.includes("__length")) // Filter out length markers
      .sort();

    for (const name of localNames) {
      const value = ctx.state.env[name];
      if (value !== undefined) {
        stdout += `${name}=${value}\n`;
      }
    }
    return result(stdout, "", 0);
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

      // Track local variable depth for bash-specific unset scoping
      markLocalVarDepth(ctx, name);

      // Mark as nameref if -n flag was used
      if (declareNameref) {
        markNameref(ctx, name);
      }
      continue;
    }

    // Check for += append syntax
    const appendMatch = arg.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\+=(.*)$/);
    if (appendMatch) {
      name = appendMatch[1];
      const appendValue = expandTildesInValue(ctx, appendMatch[2]);

      // Save previous value for scope restoration
      if (!currentScope.has(name)) {
        currentScope.set(name, ctx.state.env[name]);
      }

      // Append to existing value (or set if not defined)
      const existing = ctx.state.env[name] ?? "";
      ctx.state.env[name] = existing + appendValue;

      // Track local variable depth for bash-specific unset scoping
      markLocalVarDepth(ctx, name);

      // Mark as nameref if -n flag was used
      if (declareNameref) {
        markNameref(ctx, name);
      }
      continue;
    }

    // Check for array index assignment: name[index]=value
    const indexMatch = arg.match(
      /^([a-zA-Z_][a-zA-Z0-9_]*)\[([^\]]+)\]=(.*)$/s,
    );
    if (indexMatch) {
      name = indexMatch[1];
      const indexExpr = indexMatch[2];
      const indexValue = expandTildesInValue(ctx, indexMatch[3]);

      // Save previous array values for scope restoration
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
        const lengthKey = `${name}__length`;
        if (
          ctx.state.env[lengthKey] !== undefined &&
          !currentScope.has(lengthKey)
        ) {
          currentScope.set(lengthKey, ctx.state.env[lengthKey]);
        }
      }

      // Evaluate the index (can be arithmetic expression)
      let index: number;
      try {
        const parser = new Parser();
        const arithAst = parseArithmeticExpression(parser, indexExpr);
        index = evaluateArithmeticSync(ctx, arithAst.expression);
      } catch {
        // If parsing fails, try to parse as simple number
        const num = parseInt(indexExpr, 10);
        index = Number.isNaN(num) ? 0 : num;
      }

      // Set the array element
      ctx.state.env[`${name}_${index}`] = indexValue;

      // Update array length if needed
      const currentLength = parseInt(
        ctx.state.env[`${name}__length`] ?? "0",
        10,
      );
      if (index >= currentLength) {
        ctx.state.env[`${name}__length`] = String(index + 1);
      }

      // Track local variable depth for bash-specific unset scoping
      markLocalVarDepth(ctx, name);

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
      // Also save array elements if -a flag is used
      if (declareArray) {
        const prefix = `${name}_`;
        for (const key of Object.keys(ctx.state.env)) {
          if (key.startsWith(prefix) && !key.includes("__")) {
            if (!currentScope.has(key)) {
              currentScope.set(key, ctx.state.env[key]);
            }
          }
        }
        // Save length metadata too
        const lengthKey = `${name}__length`;
        if (
          ctx.state.env[lengthKey] !== undefined &&
          !currentScope.has(lengthKey)
        ) {
          currentScope.set(lengthKey, ctx.state.env[lengthKey]);
        }
      }
    }

    // If -a flag is used, create an empty local array
    if (declareArray && value === undefined) {
      // Clear existing array elements
      const prefix = `${name}_`;
      for (const key of Object.keys(ctx.state.env)) {
        if (key.startsWith(prefix) && !key.includes("__")) {
          delete ctx.state.env[key];
        }
      }
      // Mark as empty array
      ctx.state.env[`${name}__length`] = "0";
    } else if (value !== undefined) {
      // For namerefs, validate the target
      if (
        declareNameref &&
        value !== "" &&
        !/^[a-zA-Z_][a-zA-Z0-9_]*(\[.+\])?$/.test(value)
      ) {
        stderr += `bash: local: \`${value}': invalid variable name for name reference\n`;
        exitCode = 1;
        continue;
      }
      ctx.state.env[name] = value;
      // If allexport is enabled (set -a), auto-export the variable
      if (ctx.state.options.allexport) {
        ctx.state.exportedVars = ctx.state.exportedVars || new Set();
        ctx.state.exportedVars.add(name);
      }
    } else {
      // `local v` without assignment: bash behavior is:
      // - If the variable is already local in current scope, keep its value
      // - If there's a tempenv binding, inherit that value
      // - Otherwise, the variable is unset (not inherited from global)
      const isAlreadyLocal = currentScope.has(name);
      const hasTempEnvBinding = ctx.state.tempEnvBindings?.some((bindings) =>
        bindings.has(name),
      );
      if (!isAlreadyLocal && !hasTempEnvBinding) {
        // Not already local, no tempenv binding - make the variable unset
        delete ctx.state.env[name];
      }
      // If already local or has tempenv binding, keep the current value
    }

    // Track local variable depth for bash-specific unset scoping
    markLocalVarDepth(ctx, name);

    // Mark as nameref if -n flag was used
    if (declareNameref) {
      markNameref(ctx, name);
    }
  }

  return result("", stderr, exitCode);
}
