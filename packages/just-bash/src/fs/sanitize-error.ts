/**
 * Error message sanitization utility.
 *
 * This module has NO Node.js dependencies (no `node:fs`, etc.) so it can
 * safely be imported in browser bundles.
 */

function sanitizeWithUnixPrefixes(
  message: string,
  includeHostRuntimePrefixes: boolean,
  includeFileUrls: boolean,
): string {
  if (!message) return message;

  // Strip stack trace lines (lines starting with whitespace + "at ")
  let sanitized = message.replace(/\n\s+at\s.*/g, "");

  if (includeFileUrls) {
    sanitized = sanitized.replace(/\bfile:\/\/\/?[^\s'",)}\]:]+/g, "<path>");
  }

  // Replace real OS paths with <path>
  sanitized = sanitized.replace(
    includeHostRuntimePrefixes
      ? /(?:\/(?:Users|home|private|var|opt|Library|System|usr|etc|tmp|nix|snap|workspace|root|srv|mnt|app))\b[^\s'",)}\]:]*/g
      : /(?:\/(?:Users|home|private|var|opt|Library|System|usr|etc|tmp|nix|snap))\b[^\s'",)}\]:]*/g,
    "<path>",
  );

  // Strip Node.js internal module paths (e.g., "node:internal/modules/cjs/loader")
  sanitized = sanitized.replace(/node:internal\/[^\s'",)}\]:]+/g, "<internal>");

  // Match Windows-style absolute paths (C:\, D:\, etc.)
  sanitized = sanitized.replace(/[A-Z]:\\[^\s'",)}\]:]+/g, "<path>");

  if (includeFileUrls) {
    // Match UNC-style Windows network paths.
    sanitized = sanitized.replace(/\\\\[^\s\\]+\\[^\s'",)}\]:]+/g, "<path>");
  }

  return sanitized;
}

/**
 * Sanitize an error message to strip common real OS paths and stack traces.
 *
 * Preserves virtual paths that don't match the common host prefixes used by
 * the default runtime.
 */
export function sanitizeErrorMessage(message: string): string {
  return sanitizeWithUnixPrefixes(message, false, false);
}

/**
 * Aggressive sanitizer for host-originated errors such as worker/bootstrap
 * failures. This also scrubs file:// URLs and additional runtime roots that
 * are common in hosted environments.
 */
export function sanitizeHostErrorMessage(message: string): string {
  return sanitizeWithUnixPrefixes(message, true, true);
}
