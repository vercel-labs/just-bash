/**
 * local - Declare local variables in functions builtin
 */

import type { ExecResult } from "../../types.js";
import type { InterpreterContext } from "../types.js";

export function handleLocal(
  ctx: InterpreterContext,
  args: string[],
): ExecResult {
  if (ctx.state.localScopes.length === 0) {
    return {
      stdout: "",
      stderr: "bash: local: can only be used in a function\n",
      exitCode: 1,
    };
  }

  const currentScope = ctx.state.localScopes[ctx.state.localScopes.length - 1];

  for (const arg of args) {
    if (arg.includes("=")) {
      const [name, ...rest] = arg.split("=");
      if (!currentScope.has(name)) {
        currentScope.set(name, ctx.state.env[name]);
      }
      ctx.state.env[name] = rest.join("=");
    } else {
      if (!currentScope.has(arg)) {
        currentScope.set(arg, ctx.state.env[arg]);
      }
    }
  }

  return { stdout: "", stderr: "", exitCode: 0 };
}
