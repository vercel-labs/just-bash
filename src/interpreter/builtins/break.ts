/**
 * break - Exit from loops builtin
 */

import type { ExecResult } from "../../types.js";
import { BreakError, ExitError } from "../errors.js";
import { OK } from "../helpers/result.js";
import type { InterpreterContext } from "../types.js";

export function handleBreak(
  ctx: InterpreterContext,
  args: string[],
): ExecResult {
  // Check if we're in a loop
  // In bash, if not in a loop, break silently does nothing (returns 0)
  if (ctx.state.loopDepth === 0) {
    return OK;
  }

  let levels = 1;
  if (args.length > 0) {
    const n = Number.parseInt(args[0], 10);
    if (Number.isNaN(n) || n < 1) {
      // Invalid argument causes a fatal error in bash (exit code 128)
      throw new ExitError(
        128,
        "",
        `bash: break: ${args[0]}: numeric argument required\n`,
      );
    }
    levels = n;
  }

  throw new BreakError(levels);
}
