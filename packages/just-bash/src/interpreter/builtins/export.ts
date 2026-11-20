/**
 * export - Set environment variables builtin
 *
 * Usage:
 *   export              - List all exported variables
 *   export -p           - List all exported variables (same as no args)
 *   export NAME=value   - Set and export variable
 *   export NAME+=value  - Append value and export variable
 *   export NAME         - Export existing variable (or create empty)
 *   export -n NAME      - Un-export variable (remove from env)
 */

import type { ExecResult } from "../../types.js";
import { resolveNameref } from "../helpers/nameref.js";
import { quoteDeclareValue } from "../helpers/quoting.js";
import { markExported, unmarkExported } from "../helpers/readonly.js";
import { result, success } from "../helpers/result.js";
import { processScalarAssignment } from "../simple-command-assignments.js";
import type { InterpreterContext } from "../types.js";

export async function handleExport(
  ctx: InterpreterContext,
  args: string[],
): Promise<ExecResult> {
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
    // Only list variables that are actually exported
    const exportedVars = ctx.state.exportedVars ?? new Set();
    const sortedNames = Array.from(exportedVars).sort();

    for (const name of sortedNames) {
      const value = ctx.state.env.get(name);
      if (value !== undefined) {
        stdout += `declare -x ${name}=${quoteDeclareValue(value)}\n`;
      }
    }
    return success(stdout);
  }

  let stderr = "";
  let exitCode = 0;

  for (const arg of processedArgs) {
    const assignment = arg.match(/^([^=+]+)(\+?=)(.*)$/s);
    const name = assignment?.[1] ?? arg;
    const value = assignment?.[3];

    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
      stderr += `bash: export: \`${arg}': not a valid identifier\n`;
      exitCode = 1;
      continue;
    }

    const target = resolveNameref(ctx, name);
    if (target === undefined) continue;
    if (value !== undefined) {
      const { error } = await processScalarAssignment(
        ctx,
        name,
        value,
        assignment?.[2] === "+=",
      );
      if (error) {
        stderr += error.stderr;
        exitCode = error.exitCode;
        continue;
      }
    }

    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(target)) {
      if (!unexport) {
        stderr += `bash: export: \`${target}': not a valid identifier\n`;
        if (value === undefined) exitCode = 1;
      }
      continue;
    }
    if (unexport) {
      unmarkExported(ctx, target);
    } else {
      if (
        value === undefined &&
        target === name &&
        !ctx.state.env.has(target)
      ) {
        ctx.state.env.set(target, "");
      }
      markExported(ctx, target);
    }
  }

  return result("", stderr, exitCode);
}
