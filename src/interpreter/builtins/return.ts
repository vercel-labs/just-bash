/**
 * return - Return from a function with an exit code
 */

import type { ExecResult } from "../../types.js";
import { ReturnError } from "../errors.js";
import type { InterpreterContext } from "../types.js";

export function handleReturn(
  ctx: InterpreterContext,
  args: string[],
): ExecResult {
  // Check if we're in a function or sourced script
  if (ctx.state.callDepth === 0 && ctx.state.sourceDepth === 0) {
    return {
      stdout: "",
      stderr:
        "bash: return: can only `return' from a function or sourced script\n",
      exitCode: 1,
    };
  }

  let exitCode = ctx.state.lastExitCode;
  if (args.length > 0) {
    const arg = args[0];
    // Empty string or non-numeric is an error
    const n = Number.parseInt(arg, 10);
    if (arg === "" || Number.isNaN(n) || !/^-?\d+$/.test(arg)) {
      return {
        stdout: "",
        stderr: `bash: return: ${arg}: numeric argument required\n`,
        exitCode: 2,
      };
    }
    // Bash uses modulo 256 for exit codes
    exitCode = ((n % 256) + 256) % 256;
  }

  throw new ReturnError(exitCode);
}
