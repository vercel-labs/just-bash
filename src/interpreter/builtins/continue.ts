/**
 * continue - Skip to next loop iteration builtin
 */

import type { ExecResult } from "../../types.js";
import { BreakError, ContinueError, SubshellExitError } from "../errors.js";
import { failure, OK } from "../helpers/result.js";
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

  // bash: too many arguments causes a break, not continue
  if (args.length > 1) {
    throw new BreakError(1);
  }

  let levels = 1;
  if (args.length > 0) {
    const n = Number.parseInt(args[0], 10);
    if (Number.isNaN(n) || n < 1) {
      return failure(`bash: continue: ${args[0]}: numeric argument required\n`);
    }
    levels = n;
  }

  throw new ContinueError(levels);
}
