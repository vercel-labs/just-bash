/**
 * ExecResult factory functions for cleaner code.
 *
 * These helpers reduce verbosity and improve readability when
 * constructing ExecResult objects throughout the interpreter.
 */

import type { ExecResult } from "../../types.js";

/**
 * A successful result with no output.
 * Use this for commands that succeed silently.
 */
export const OK: ExecResult = Object.freeze({
  stdout: "",
  stderr: "",
  exitCode: 0,
});

/**
 * Create a successful result with optional stdout.
 *
 * @param stdout - Output to include (default: "")
 * @returns ExecResult with exitCode 0
 */
export function success(stdout = ""): ExecResult {
  return { stdout, stderr: "", exitCode: 0 };
}

/**
 * Create a failure result with stderr message.
 *
 * @param stderr - Error message to include
 * @param exitCode - Exit code (default: 1)
 * @returns ExecResult with the specified exitCode
 */
export function failure(stderr: string, exitCode = 1): ExecResult {
  return { stdout: "", stderr, exitCode };
}

/**
 * Create a result with all fields specified.
 *
 * @param stdout - Standard output
 * @param stderr - Standard error
 * @param exitCode - Exit code
 * @returns ExecResult with all fields
 */
export function result(
  stdout: string,
  stderr: string,
  exitCode: number,
): ExecResult {
  return { stdout, stderr, exitCode };
}
