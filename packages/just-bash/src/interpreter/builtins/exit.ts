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
    const arg = args[0];
    // Empty string or non-numeric is an error
    if (arg === "" || !/^-?\d+$/.test(arg)) {
      stderr = `bash: exit: ${arg}: numeric argument required\n`;
      exitCode = 2;
    } else {
      // Parse exactly before reducing. Number.parseInt loses low bits for large
      // operands, producing the wrong modulo-256 status.
      const parsed = BigInt(arg);
      exitCode = Number(((parsed % 256n) + 256n) % 256n);
    }
  }

  throw new ExitError(exitCode, "", stderr);
}
