/**
 * Shared utilities for real-filesystem-backed IFileSystem implementations
 * (OverlayFs and ReadWriteFs).
 *
 * Security-critical path validation logic lives here so both implementations
 * stay consistent.
 */

import * as fs from "node:fs";
import * as nodePath from "node:path";

/**
 * Normalize a virtual path: resolve `.` and `..`, ensure it starts with `/`,
 * strip trailing slashes.  Pure function, no I/O.
 */
export function normalizePath(path: string): string {
  if (!path || path === "/") return "/";

  let normalized =
    path.endsWith("/") && path !== "/" ? path.slice(0, -1) : path;

  if (!normalized.startsWith("/")) {
    normalized = `/${normalized}`;
  }

  const parts = normalized.split("/").filter((p) => p && p !== ".");
  const resolved: string[] = [];

  for (const part of parts) {
    if (part === "..") {
      resolved.pop();
    } else {
      resolved.push(part);
    }
  }

  return `/${resolved.join("/")}` || "/";
}

/**
 * Check whether `resolved` is equal to, or a child of, `canonicalRoot`.
 * Uses a boundary-safe prefix check (appends `/`) so that `/data` does not
 * match `/datastore`.
 */
export function isPathWithinRoot(
  resolved: string,
  canonicalRoot: string,
): boolean {
  return resolved === canonicalRoot || resolved.startsWith(`${canonicalRoot}/`);
}

/**
 * Validate that a real filesystem path stays within the sandbox root after
 * resolving all OS-level symlinks (including in parent components).
 *
 * Uses `realpathSync`; when the path does not exist (`ENOENT`) it walks up
 * to the nearest existing parent.  Returns `false` for any path that escapes
 * the sandbox (fail-closed on unexpected errors).
 */
export function validateRealPath(
  realPath: string,
  canonicalRoot: string,
): boolean {
  try {
    const resolved = fs.realpathSync(realPath);
    return isPathWithinRoot(resolved, canonicalRoot);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      // Path doesn't exist yet - validate parent instead
      const parent = nodePath.dirname(realPath);
      if (parent === realPath) return false;
      return validateRealPath(parent, canonicalRoot);
    }
    // For other errors (EACCES, EIO, etc.), fail closed
    return false;
  }
}

/**
 * Resolve a real filesystem path to its canonical form and verify it stays
 * within the sandbox root.  Returns the canonical path on success, or `null`
 * if the path escapes the root (fail-closed on unexpected errors).
 *
 * Unlike `validateRealPath` (which returns a boolean), this function returns
 * the canonical path so callers can use it for subsequent I/O, closing the
 * TOCTOU gap where the original (unresolved) path could be swapped between
 * validation and use.
 */
export function resolveCanonicalPath(
  realPath: string,
  canonicalRoot: string,
): string | null {
  try {
    const resolved = fs.realpathSync(realPath);
    return isPathWithinRoot(resolved, canonicalRoot) ? resolved : null;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      const parent = nodePath.dirname(realPath);
      if (parent === realPath) return null;
      const parentCanon = resolveCanonicalPath(parent, canonicalRoot);
      if (parentCanon === null) return null;

      // Defense-in-depth: the leaf component might be a broken symlink
      // whose target doesn't exist (causing the ENOENT above).
      // realpathSync tried to follow it, failed, and we walked up.
      // Check with lstatSync (which doesn't follow symlinks) whether
      // the leaf is a symlink, and if so, validate its target stays
      // within the sandbox by recursing through resolveCanonicalPath
      // (which handles root canonicalization and ENOENT walk-up).
      try {
        const leafStat = fs.lstatSync(realPath);
        if (leafStat.isSymbolicLink()) {
          const target = fs.readlinkSync(realPath);
          const resolvedTarget = nodePath.isAbsolute(target)
            ? target
            : nodePath.resolve(nodePath.dirname(realPath), target);
          const validatedTarget = resolveCanonicalPath(
            resolvedTarget,
            canonicalRoot,
          );
          if (validatedTarget === null) {
            return null;
          }
        }
      } catch {
        // lstatSync ENOENT: the leaf truly doesn't exist (not a symlink
        // entry on disk), so the walk-up basename is correct.
      }

      return nodePath.join(parentCanon, nodePath.basename(realPath));
    }
    return null;
  }
}

/**
 * Resolve a real filesystem path to its canonical form, verify it stays
 * within the sandbox root, AND reject the path if any symlinks were
 * traversed.
 *
 * Detection: compare the relative path from `root` (unresolved) with the
 * relative path from `canonicalRoot` (resolved).  A mismatch means a
 * symlink was followed somewhere in the path.
 *
 * This piggybacks on the `realpathSync` call inside `resolveCanonicalPath`
 * — the only extra cost is one string comparison.
 */
export function resolveCanonicalPathNoSymlinks(
  realPath: string,
  root: string,
  canonicalRoot: string,
): string | null {
  const canonical = resolveCanonicalPath(realPath, canonicalRoot);
  if (canonical === null) return null;

  const resolvedReal = nodePath.resolve(realPath);
  const relFromRoot = resolvedReal.slice(root.length);
  const relFromCanonical = canonical.slice(canonicalRoot.length);

  if (relFromRoot !== relFromCanonical) {
    return null; // symlink was traversed
  }

  // Defense-in-depth: detect broken symlinks at the leaf component.
  // resolveCanonicalPath's ENOENT walk-up masks broken symlinks: when
  // realpathSync follows a symlink whose target doesn't exist, it returns
  // ENOENT and the walk-up appends the literal basename — making the
  // relative paths match even though the leaf IS a symlink.  Without this
  // check, writeFile through a broken symlink pointing outside the sandbox
  // would follow the link and create the target file.
  try {
    const stat = fs.lstatSync(resolvedReal);
    if (stat.isSymbolicLink()) {
      return null; // broken symlink at the leaf
    }
  } catch {
    // ENOENT: path truly doesn't exist (not a symlink entry) — safe,
    // any subsequent write creates a new file within the sandbox.
  }

  return canonical;
}

/**
 * Validate that a root directory exists and is actually a directory.
 * Throws with a descriptive message including `fsName` (e.g. "OverlayFs",
 * "ReadWriteFs") on failure.  Does NOT include the real root path in the
 * error message to prevent information leakage.
 */
export function validateRootDirectory(root: string, fsName: string): void {
  if (!fs.existsSync(root)) {
    throw new Error(`${fsName} root does not exist`);
  }
  const stat = fs.statSync(root);
  if (!stat.isDirectory()) {
    throw new Error(`${fsName} root is not a directory`);
  }
}

/**
 * Sanitize an error message to strip real OS filesystem paths and stack traces.
 *
 * - Replaces common OS path prefixes (/Users/, /home/, /private/, C:\, etc.)
 *   with `<path>` to prevent information leakage about the host filesystem.
 * - Strips stack trace lines (`\n    at ...`).
 * - Preserves error codes (ENOENT, EACCES, etc.) and virtual paths that don't
 *   match known OS prefixes.
 */
export function sanitizeErrorMessage(message: string): string {
  if (!message) return message;

  // Strip stack trace lines (lines starting with whitespace + "at ")
  let sanitized = message.replace(/\n\s+at\s.*/g, "");

  // Replace real OS paths with <path>
  // Match absolute Unix-style paths that start with common OS prefixes
  sanitized = sanitized.replace(
    /(?:\/(?:Users|home|private|var|opt|Library|System|usr|etc|tmp|nix|snap))\b[^\s'",)}\]:]*/g,
    "<path>",
  );

  // Match Windows-style absolute paths (C:\, D:\, etc.)
  sanitized = sanitized.replace(/[A-Z]:\\[^\s'",)}\]:]+/g, "<path>");

  return sanitized;
}

/**
 * Validate that a path does not contain null bytes.
 * Null bytes in paths can be used to truncate filenames or bypass security
 * filters.
 */
export function validatePath(path: string, operation: string): void {
  if (path.includes("\0")) {
    throw new Error(`ENOENT: path contains null byte, ${operation} '${path}'`);
  }
}

/**
 * Sanitize a raw OS symlink target so it does not leak real filesystem paths
 * outside the sandbox.
 *
 * - Relative targets are returned as-is (they don't leak real paths).
 * - Absolute targets that resolve within the canonical root are converted to
 *   a path relative to the root (the caller decides how to present it).
 * - Absolute targets outside the root are reduced to `basename` only.
 *
 * Returns `{ withinRoot: true, relativePath }` when the target is inside the
 * sandbox, or `{ withinRoot: false, safeName }` when it is outside.
 */
export function sanitizeSymlinkTarget(
  rawTarget: string,
  canonicalRoot: string,
):
  | { withinRoot: true; relativePath: string }
  | { withinRoot: false; safeName: string } {
  if (!nodePath.isAbsolute(rawTarget)) {
    // Relative targets don't leak real paths; treat as within-root
    return { withinRoot: true, relativePath: rawTarget };
  }

  // Absolute target: resolve and check if it's within root
  let resolved: string;
  try {
    resolved = fs.realpathSync(rawTarget);
  } catch {
    resolved = nodePath.resolve(rawTarget);
  }

  if (isPathWithinRoot(resolved, canonicalRoot)) {
    const relativePath = resolved.slice(canonicalRoot.length) || "/";
    return { withinRoot: true, relativePath };
  }

  // Outside root - return just the basename to avoid leaking real paths
  return { withinRoot: false, safeName: nodePath.basename(rawTarget) };
}
