/**
 * unset - Remove variables/functions builtin
 */

import type { ExecResult } from "../../types.js";
import type { InterpreterContext } from "../types.js";

export function handleUnset(
  ctx: InterpreterContext,
  args: string[],
): ExecResult {
  for (const arg of args) {
    delete ctx.state.env[arg];
    ctx.state.functions.delete(arg);
  }
  return { stdout: "", stderr: "", exitCode: 0 };
}
