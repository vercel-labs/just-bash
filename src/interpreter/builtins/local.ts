/**
 * local - Declare local variables in functions builtin
 */

import type { ExecResult } from "../../types.js";
import { failure, result } from "../helpers/index.js";
import type { InterpreterContext } from "../types.js";

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

  for (const arg of args) {
    let name: string;
    let value: string | undefined;

    if (arg.includes("=")) {
      const eqIdx = arg.indexOf("=");
      name = arg.slice(0, eqIdx);
      value = arg.slice(eqIdx + 1);
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
  }

  return result("", stderr, exitCode);
}
