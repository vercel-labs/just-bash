/**
 * Error helper functions for the interpreter.
 */

/**
 * Extract message from an unknown error value.
 * Handles both Error instances and other thrown values.
 */
export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The errno of a filesystem error, read off `code` when the error carries one
 * and off the `ECODE: ...` message prefix the virtual filesystems use otherwise.
 */
export function getErrorCode(error: unknown): string | undefined {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  return error instanceof Error
    ? /^(E[A-Z]+)\b/.exec(error.message)?.[1]
    : undefined;
}
