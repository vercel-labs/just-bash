/**
 * Error helper functions for the interpreter.
 */

import { SandboxBoundaryError } from "../../fs/sandbox-boundary-error.js";

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

/**
 * What bash (strerror) says for each errno a filesystem can answer with. A
 * command prints the phrase for the error it got, never one phrase for all of
 * them: a read-only file is not a missing file.
 */
const ERRNO_REASONS = new Map<string, string>([
  ["EACCES", "Permission denied"],
  ["EBUSY", "Device or resource busy"],
  ["EEXIST", "File exists"],
  ["EFBIG", "File too large"],
  ["EINVAL", "Invalid argument"],
  ["EIO", "Input/output error"],
  ["EISDIR", "Is a directory"],
  ["ELOOP", "Too many levels of symbolic links"],
  ["ENAMETOOLONG", "File name too long"],
  ["ENOENT", "No such file or directory"],
  ["ENOSPC", "No space left on device"],
  ["ENOTDIR", "Not a directory"],
  ["ENOTEMPTY", "Directory not empty"],
  ["EPERM", "Operation not permitted"],
  ["EROFS", "Read-only file system"],
]);

/**
 * The errno of a filesystem error when it is one of the known errnos, or
 * undefined. The sandbox's own refusals (`SandboxBoundaryError`: a path outside
 * the root, a symlink, a special file) carry an `EACCES:` message but are policy,
 * not a file permission, so they have no errno here and keep propagating.
 */
export function errnoCode(error: unknown): string | undefined {
  if (error instanceof SandboxBoundaryError) return undefined;
  const code = getErrorCode(error);
  return code !== undefined && ERRNO_REASONS.has(code) ? code : undefined;
}

/**
 * The phrase for a filesystem error, from its errno alone, or undefined when
 * the error is not one of the known errnos. Only those become a diagnostic: a
 * cancellation, an execution limit or a security violation carries no errno
 * of this list and must keep propagating.
 */
export function errnoReason(error: unknown): string | undefined {
  const code = errnoCode(error);
  return code === undefined ? undefined : ERRNO_REASONS.get(code);
}

/**
 * The phrase for a failed file operation, falling back to `fallback` (the
 * phrase commands used before they looked) when the error names no known errno.
 */
export function describeFsError(
  error: unknown,
  fallback = "No such file or directory",
): string {
  return errnoReason(error) ?? fallback;
}
