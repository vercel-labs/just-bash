import { FileSystemPolicyError } from "../fs/traversal.js";
import {
  ExecutionAbortedError,
  ExecutionLimitError,
} from "../interpreter/errors.js";
import { getErrorCode } from "../interpreter/helpers/errors.js";

// Only errno-coded filesystem failures are recoverable. Never expose backend
// messages, or turn cancellation, execution limits or typed policy errors into stderr.
const FILESYSTEM_ERROR_REASONS = new Map<string, string>([
  ["EACCES", "Permission denied"],
  ["EIO", "Input/output error"],
  ["ELOOP", "Too many levels of symbolic links"],
  ["ENAMETOOLONG", "File name too long"],
  ["ENOENT", "No such file or directory"],
  ["ENOTDIR", "Not a directory"],
  ["EPERM", "Permission denied"],
]);

export function describeFileSystemError(error: unknown): string | null {
  if (
    error instanceof ExecutionAbortedError ||
    error instanceof ExecutionLimitError ||
    error instanceof FileSystemPolicyError
  )
    return null;
  const code = getErrorCode(error);
  return code === undefined
    ? null
    : (FILESYSTEM_ERROR_REASONS.get(code) ?? null);
}
