/**
 * export - Set environment variables builtin
 *
 * Usage:
 *   export              - List all exported variables
 *   export -p           - List all exported variables (same as no args)
 *   export NAME=value   - Set and export variable
 *   export NAME         - Export existing variable (or create empty)
 *   export -n NAME      - Un-export variable (remove from env)
 */

import type { ExecResult } from "../../types.js";
import { OK, result, success } from "../helpers/result.js";
import type { InterpreterContext } from "../types.js";

export function handleExport(
  ctx: InterpreterContext,
  args: string[],
): ExecResult {
  // Handle -n flag for un-export
  let unexport = false;
  const processedArgs: string[] = [];

  for (const arg of args) {
    if (arg === "-n") {
      unexport = true;
    } else if (arg === "-p") {
    } else if (arg === "--") {
    } else {
      processedArgs.push(arg);
    }
  }

  // No args or just -p: list all exported variables
  if (processedArgs.length === 0 && !unexport) {
    let stdout = "";
    const entries = Object.entries(ctx.state.env)
      .filter(([key]) => !key.startsWith("BASH_ALIAS_")) // Don't list aliases
      .sort(([a], [b]) => a.localeCompare(b));

    for (const [name, value] of entries) {
      // Quote the value, escaping any quotes inside
      const escapedValue = value.replace(/'/g, "'\\''");
      stdout += `declare -x ${name}='${escapedValue}'\n`;
    }
    return success(stdout);
  }

  // Handle un-export
  if (unexport) {
    for (const arg of processedArgs) {
      // Just remove the = part if present, we only care about the name
      const name = arg.split("=")[0];
      delete ctx.state.env[name];
    }
    return OK;
  }

  // Process each argument
  let stderr = "";
  let exitCode = 0;

  for (const arg of processedArgs) {
    let name: string;
    let value: string | undefined;

    if (arg.includes("=")) {
      // export NAME=value
      const eqIdx = arg.indexOf("=");
      name = arg.slice(0, eqIdx);
      value = arg.slice(eqIdx + 1);
    } else {
      // export NAME (without value)
      name = arg;
    }

    // Validate variable name: must start with letter/underscore, contain only alphanumeric/_
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
      stderr += `bash: export: \`${arg}': not a valid identifier\n`;
      exitCode = 1;
      continue;
    }

    if (value !== undefined) {
      ctx.state.env[name] = value;
    } else {
      // If variable doesn't exist, create it as empty
      if (!(name in ctx.state.env)) {
        ctx.state.env[name] = "";
      }
      // If it exists, it's already "exported" in our model
    }
  }

  return result("", stderr, exitCode);
}
