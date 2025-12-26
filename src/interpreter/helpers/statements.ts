/**
 * Statement execution helpers for the interpreter.
 *
 * Consolidates the common pattern of executing a list of statements
 * and accumulating their output.
 */

import type { StatementNode } from "../../ast/types.js";
import type { ExecResult } from "../../types.js";
import { ErrexitError, ExitError, isScopeExitError } from "../errors.js";
import type { InterpreterContext } from "../types.js";
import { getErrorMessage } from "./errors.js";

/**
 * Execute a list of statements and accumulate their output.
 * Handles scope exit errors (break, continue, return) and errexit properly.
 *
 * @param ctx - Interpreter context
 * @param statements - Statements to execute
 * @param initialStdout - Initial stdout to prepend (default "")
 * @param initialStderr - Initial stderr to prepend (default "")
 * @returns Accumulated stdout, stderr, and final exit code
 */
export async function executeStatements(
  ctx: InterpreterContext,
  statements: StatementNode[],
  initialStdout = "",
  initialStderr = "",
): Promise<ExecResult> {
  let stdout = initialStdout;
  let stderr = initialStderr;
  let exitCode = 0;

  try {
    for (const stmt of statements) {
      const result = await ctx.executeStatement(stmt);
      stdout += result.stdout;
      stderr += result.stderr;
      exitCode = result.exitCode;
    }
  } catch (error) {
    if (
      isScopeExitError(error) ||
      error instanceof ErrexitError ||
      error instanceof ExitError
    ) {
      error.prependOutput(stdout, stderr);
      throw error;
    }
    return {
      stdout,
      stderr: `${stderr}${getErrorMessage(error)}\n`,
      exitCode: 1,
    };
  }

  return { stdout, stderr, exitCode };
}
