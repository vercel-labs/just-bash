/**
 * continue - Skip to next loop iteration builtin
 */

import type { ExecResult } from "../../types.js";
import { ContinueError } from "../errors.js";
import type { InterpreterContext } from "../types.js";

export function handleContinue(
  ctx: InterpreterContext,
  args: string[],
): ExecResult {
  // Check if we're in a loop
  if (ctx.state.loopDepth === 0) {
    return {
      stdout: "",
      stderr:
        "bash: continue: only meaningful in a `for', `while', or `until' loop\n",
      exitCode: 0, // bash returns 0 even when not in a loop
    };
  }

  let levels = 1;
  if (args.length > 0) {
    const n = Number.parseInt(args[0], 10);
    if (Number.isNaN(n) || n < 1) {
      return {
        stdout: "",
        stderr: `bash: continue: ${args[0]}: numeric argument required\n`,
        exitCode: 1,
      };
    }
    levels = n;
  }

  throw new ContinueError(levels);
}
