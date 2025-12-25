/**
 * Control Flow Errors
 *
 * Error classes used to implement shell control flow:
 * - break: Exit loops
 * - continue: Skip to next iteration
 * - return: Exit functions
 * - errexit: Exit on error (set -e)
 * - nounset: Error on unset variables (set -u)
 *
 * All control flow errors carry stdout/stderr to accumulate output
 * as they propagate through the execution stack.
 */

/**
 * Base class for all control flow errors.
 * Carries stdout/stderr to preserve output during propagation.
 */
export abstract class ControlFlowError extends Error {
  constructor(
    message: string,
    public stdout: string = "",
    public stderr: string = "",
  ) {
    super(message);
  }

  /**
   * Prepend output from the current context before re-throwing.
   */
  prependOutput(stdout: string, stderr: string): void {
    this.stdout = stdout + this.stdout;
    this.stderr = stderr + this.stderr;
  }
}

/**
 * Error thrown when break is called to exit loops.
 */
export class BreakError extends ControlFlowError {
  readonly name = "BreakError";

  constructor(
    public levels: number = 1,
    stdout: string = "",
    stderr: string = "",
  ) {
    super("break", stdout, stderr);
  }
}

/**
 * Error thrown when continue is called to skip to next iteration.
 */
export class ContinueError extends ControlFlowError {
  readonly name = "ContinueError";

  constructor(
    public levels: number = 1,
    stdout: string = "",
    stderr: string = "",
  ) {
    super("continue", stdout, stderr);
  }
}

/**
 * Error thrown when return is called to exit a function.
 */
export class ReturnError extends ControlFlowError {
  readonly name = "ReturnError";

  constructor(
    public exitCode: number = 0,
    stdout: string = "",
    stderr: string = "",
  ) {
    super("return", stdout, stderr);
  }
}

/**
 * Error thrown when set -e (errexit) is enabled and a command fails.
 */
export class ErrexitError extends ControlFlowError {
  readonly name = "ErrexitError";

  constructor(
    public readonly exitCode: number,
    stdout: string = "",
    stderr: string = "",
  ) {
    super(`errexit: command exited with status ${exitCode}`, stdout, stderr);
  }
}

/**
 * Error thrown when set -u (nounset) is enabled and an unset variable is referenced.
 */
export class NounsetError extends ControlFlowError {
  readonly name = "NounsetError";

  constructor(
    public varName: string,
    stdout: string = "",
  ) {
    super(
      `${varName}: unbound variable`,
      stdout,
      `bash: ${varName}: unbound variable\n`,
    );
  }
}

/**
 * Error thrown when exit builtin is called to terminate the script.
 */
export class ExitError extends ControlFlowError {
  readonly name = "ExitError";

  constructor(
    public readonly exitCode: number,
    stdout: string = "",
    stderr: string = "",
  ) {
    super(`exit`, stdout, stderr);
  }
}

/**
 * Type guard to check if an error is a control flow error that should propagate.
 */
export function isControlFlowError(error: unknown): error is ControlFlowError {
  return error instanceof ControlFlowError;
}

/**
 * Type guard for errors that exit the current scope (return, break, continue).
 * These need special handling vs errexit/nounset which terminate execution.
 */
export function isScopeExitError(
  error: unknown,
): error is BreakError | ContinueError | ReturnError {
  return (
    error instanceof BreakError ||
    error instanceof ContinueError ||
    error instanceof ReturnError
  );
}
