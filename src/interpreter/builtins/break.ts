/**
 * break - Exit from loops builtin
 */

import type { ExecResult } from "../../types.js";
import { BreakError } from "../control-flow.js";
import type { InterpreterContext } from "../types.js";

export function handleBreak(
  ctx: InterpreterContext,
  args: string[],
): ExecResult {
  // Check if we're in a loop
  if (ctx.state.loopDepth === 0) {
    return {
      stdout: "",
      stderr:
        "bash: break: only meaningful in a `for', `while', or `until' loop\n",
      exitCode: 0, // bash returns 0 even when not in a loop
    };
  }

  let levels = 1;
  if (args.length > 0) {
    const n = Number.parseInt(args[0], 10);
    if (Number.isNaN(n) || n < 1) {
      return {
        stdout: "",
        stderr: `bash: break: ${args[0]}: numeric argument required\n`,
        exitCode: 1,
      };
    }
    levels = n;
  }

  throw new BreakError(levels);
}
