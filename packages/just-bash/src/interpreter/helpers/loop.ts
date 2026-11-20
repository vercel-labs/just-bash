/**
 * Loop Error Handling Helpers
 *
 * Consolidates the repeated error handling logic used in all loop constructs
 * (for, c-style for, while, until).
 */

import {
  BreakError,
  ContinueError,
  ErrexitError,
  ExecutionLimitError,
  ExitError,
  ReturnError,
} from "../errors.js";
import type { InterpreterContext } from "../types.js";
import { getErrorMessage } from "./errors.js";

export type LoopAction = "break" | "continue" | "rethrow" | "error";

export interface LoopErrorResult {
  action: LoopAction;
  stdout: string;
  stderr: string;
  /**
   * Status the loop should adopt as "last command executed".
   *
   * For "break"/"continue" this is 0: bash's `break` and `continue` are
   * builtins that return 0, and they are the last command the body ran, so
   * the loop must not report the status of whatever failed before them.
   * For "error" it is the failure status.
   */
  exitCode?: number;
  error?: unknown;
}

/**
 * Exit status of the `break`/`continue` builtins themselves.
 *
 * A loop left via `break`/`continue` reports this, not the status of the
 * last command that ran before it:
 *
 *   while :; do false; break; done; echo $?   # 0, not 1
 */
export const BREAK_CONTINUE_STATUS = 0;

/**
 * Adopt `status` as the loop's "last command executed" and publish it to `$?`.
 *
 * The loop tracks its own exit code for the value it finally returns, but `$?`
 * has to move with it. A `for` loop runs nothing between the `continue` and
 * the next iteration's first command, so leaving `$?` behind lets the failed
 * command before the `continue` show up there:
 *
 *   for i in 1 2; do echo "$?"; false; continue; done   # 0 0, not 0 1
 *
 * `while`/`until` happen to hide this because their condition runs in between
 * and resets `$?` - they are synchronised here all the same.
 */
export function adoptLoopStatus(
  ctx: InterpreterContext,
  status: number,
): number {
  ctx.state.lastExitCode = status;
  ctx.state.env.set("?", String(status));
  return status;
}

/**
 * Handle errors thrown during loop body execution.
 *
 * @param error - The caught error
 * @param stdout - Current accumulated stdout
 * @param stderr - Current accumulated stderr
 * @param loopDepth - Current loop nesting depth from ctx.state.loopDepth
 * @returns Result indicating what action the loop should take
 */
export function handleLoopError(
  error: unknown,
  stdout: string,
  stderr: string,
  loopDepth: number,
): LoopErrorResult {
  if (error instanceof BreakError) {
    stdout += error.stdout;
    stderr += error.stderr;
    // Only propagate if levels > 1 AND we're not at the outermost loop
    // Per bash docs: "If n is greater than the number of enclosing loops,
    // the last enclosing loop is exited"
    if (error.levels > 1 && loopDepth > 1) {
      error.levels--;
      error.stdout = stdout;
      error.stderr = stderr;
      return { action: "rethrow", stdout, stderr, error };
    }
    return {
      action: "break",
      stdout,
      stderr,
      exitCode: BREAK_CONTINUE_STATUS,
    };
  }

  if (error instanceof ContinueError) {
    stdout += error.stdout;
    stderr += error.stderr;
    // Only propagate if levels > 1 AND we're not at the outermost loop
    // Per bash docs: "If n is greater than the number of enclosing loops,
    // the last enclosing loop is resumed"
    if (error.levels > 1 && loopDepth > 1) {
      error.levels--;
      error.stdout = stdout;
      error.stderr = stderr;
      return { action: "rethrow", stdout, stderr, error };
    }
    return {
      action: "continue",
      stdout,
      stderr,
      exitCode: BREAK_CONTINUE_STATUS,
    };
  }

  if (
    error instanceof ReturnError ||
    error instanceof ErrexitError ||
    error instanceof ExitError ||
    error instanceof ExecutionLimitError
  ) {
    error.prependOutput(stdout, stderr);
    return { action: "rethrow", stdout, stderr, error };
  }

  // Generic error - return error result
  const message = getErrorMessage(error);
  return {
    action: "error",
    stdout,
    stderr: `${stderr}${message}\n`,
    exitCode: 1,
  };
}
