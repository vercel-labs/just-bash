/**
 * continue - Skip to next loop iteration builtin
 */

import type { ExecResult } from "../../types.js";
import { ContinueError, ExitError, SubshellExitError } from "../errors.js";
import { OK } from "../helpers/result.js";
import type { InterpreterContext } from "../types.js";

export function handleContinue(
  ctx: InterpreterContext,
  args: string[],
): ExecResult {
  // Check if we're in a loop
  if (ctx.state.loopDepth === 0) {
    // If we're in a subshell spawned from a loop context, exit the subshell
    if (ctx.state.parentHasLoopContext) {
      throw new SubshellExitError();
    }
    // Otherwise, continue silently does nothing (returns 0)
    return OK;
  }

  // bash: too many arguments is an error (exit code 1)
  if (args.length > 1) {
    throw new ExitError(1, "", "bash: continue: too many arguments\n");
  }

  let levels = 1;
  if (args.length > 0) {
    const n = Number.parseInt(args[0], 10);
    if (Number.isNaN(n) || n < 1) {
      throw new ExitError(
        1,
        "",
        `bash: continue: ${args[0]}: numeric argument required\n`,
      );
    }
    levels = n;
  }

  throw new ContinueError(levels);
}
