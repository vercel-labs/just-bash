/**
 * exit - Exit shell builtin
 */

import { ExitError } from "../errors.js";
import type { InterpreterContext } from "../types.js";

export function handleExit(ctx: InterpreterContext, args: string[]): never {
  let exitCode: number;
  let stderr = "";

  if (args.length === 0) {
    // Use last command's exit code when no argument given
    exitCode = ctx.state.lastExitCode;
  } else {
    const parsed = Number.parseInt(args[0], 10);
    if (Number.isNaN(parsed)) {
      stderr = `bash: exit: ${args[0]}: numeric argument required\n`;
      exitCode = 2;
    } else {
      // Exit codes are modulo 256 (wrap around)
      exitCode = ((parsed % 256) + 256) % 256;
    }
  }

  throw new ExitError(exitCode, "", stderr);
}
