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
 * What coreutils print for each errno a file operation commonly fails with.
 */
const FS_ERROR_MESSAGES = new Map<string, string>([
  ["EACCES", "Permission denied"],
  ["EIO", "Input/output error"],
  ["EISDIR", "Is a directory"],
  ["ELOOP", "Too many levels of symbolic links"],
  ["ENAMETOOLONG", "File name too long"],
  ["ENOENT", "No such file or directory"],
  ["ENOTDIR", "Not a directory"],
  ["EPERM", "Operation not permitted"],
]);

/**
 * The message a command prints for a failed file operation, from the error's
 * errno: read off `code` when the error carries one, and off the
 * `ECODE: ...` message prefix the virtual filesystems use otherwise. An error
 * with no errno this table knows reads as a missing file.
 */
export function describeFsError(error: unknown): string {
  const code =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
      ? error.code
      : error instanceof Error
        ? /^(E[A-Z]+)\b/.exec(error.message)?.[1]
        : undefined;
  return (
    (code !== undefined && FS_ERROR_MESSAGES.get(code)) ||
    "No such file or directory"
  );
}
