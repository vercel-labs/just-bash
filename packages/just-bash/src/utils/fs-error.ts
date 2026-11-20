import { ControlFlowError } from "../interpreter/errors.js";
import { getErrorCode } from "../interpreter/helpers/errors.js";
import { SecurityViolationError } from "../security/defense-in-depth-box.js";

const reasons = new Map([
  ["ENOENT", "No such file or directory"],
  ["ENOTDIR", "Not a directory"],
  ["EISDIR", "Is a directory"],
  ["EACCES", "Permission denied"],
  ["EPERM", "Operation not permitted"],
  ["EROFS", "Read-only file system"],
  ["ENOSPC", "No space left on device"],
  ["EFBIG", "File too large"],
  ["EIO", "Input/output error"],
  ["EDQUOT", "Disk quota exceeded"],
  ["EMFILE", "Too many open files"],
  ["ENFILE", "Too many open files in system"],
  ["ENAMETOOLONG", "File name too long"],
  ["ELOOP", "Too many levels of symbolic links"],
  ["EINVAL", "Invalid argument"],
]);

/** Describe filesystem failures without exposing paths from the underlying error. */
export function describeFsError(error: unknown): string {
  if (
    error instanceof ControlFlowError ||
    error instanceof SecurityViolationError
  )
    throw error;
  const code = getErrorCode(error);
  const reason = code && reasons.get(code);
  return reason || "Input/output error";
}
