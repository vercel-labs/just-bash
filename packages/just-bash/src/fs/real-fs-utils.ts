/**
 * Shared utilities for real-filesystem-backed IFileSystem implementations
 * (OverlayFs and ReadWriteFs).
 *
 * Security-critical path validation logic lives here so both implementations
 * stay consistent.
 *
 * Pure path utilities (normalizePath, validatePath, dirname, resolvePath, etc.)
 * live in path-utils.ts (no node:fs dependency, browser-safe) and are
 * re-exported here for convenience.
 */

import * as fs from "node:fs";
import * as nodePath from "node:path";

// Re-export path utilities used by callers that import from real-fs-utils.
export {
  isSameOrDescendantPath,
  normalizePath,
  validatePath,
} from "./path-utils.js";

/**
 * Check whether `resolved` is equal to, or a child of, `canonicalRoot`.
 * Uses a boundary-safe prefix check (appends `/`) so that `/data` does not
 * match `/datastore`.
 */
export function isPathWithinRoot(
  resolved: string,
  canonicalRoot: string,
): boolean {
  const pathApi = /^[A-Za-z]:[\\/]/.test(canonicalRoot)
    ? nodePath.win32
    : nodePath.posix;
  const relative = pathApi.relative(canonicalRoot, resolved);
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${pathApi.sep}`) &&
      !pathApi.isAbsolute(relative))
  );
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
 * Error thrown when realpath(3) itself fails for a reason other than a
 * missing path (ENOENT is handled by walking up to the nearest existing
 * parent). It carries the errno code so callers can report the real
 * failure instead of collapsing it into "resolves outside sandbox".
 * The message carries no filesystem path: callers format it with the
 * virtual path they own, so no real path can leak to sandbox users.
 */
export class RealpathError extends Error {
  readonly code: string;
  readonly description: string;
  constructor(code: string, description: string) {
    super(`${code}: ${description}`);
    this.name = "RealpathError";
    this.code = code;
    this.description = description;
  }
}

/** Build a RealpathError from a caught Node.js error, if it carries a code. */
function toRealpathError(e: unknown): RealpathError | null {
  const err = e as NodeJS.ErrnoException;
  const code = err?.code;
  if (typeof code !== "string" || code === "") return null;
  // Node formats errno messages as "CODE: description, syscall 'path'".
  const match = /^[A-Z0-9]+: ([^,]+),/.exec(err.message ?? "");
  return new RealpathError(code, match?.[1] ?? code);
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
 *
 * Throws RealpathError when realpath(3) fails with an errno other than
 * ENOENT (e.g. ENOTDIR, EACCES, ELOOP). The failure may have happened
 * past a symlink that points outside the root, so callers must check the
 * failing lookup stayed inside the sandbox and complied with the symlink
 * policy (see isRealpathFailureInsideSandbox) before surfacing the errno;
 * otherwise they must treat it as an escape.
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
          let target: string;
          try {
            target = fs.readlinkSync(realPath);
          } catch {
            return null;
          }
          const canonicalLeaf = nodePath.join(
            parentCanon,
            nodePath.basename(realPath),
          );
          const components = target.split(
            nodePath.sep === "\\" ? /[\\/]/ : "/",
          );
          // A canonical absolute target or one containing `..` can be
          // checked without losing the spelling of an intermediate link.
          if (
            (components.includes("..") ||
              (nodePath.isAbsolute(target) &&
                isPathWithinRoot(target, canonicalRoot))) &&
            !isRealpathFailureInsideSandbox(
              nodePath.relative(canonicalRoot, canonicalLeaf),
              canonicalRoot,
              true,
            )
          ) {
            return null;
          }
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
          return validatedTarget;
        }
      } catch (e) {
        // A RealpathError from the target check is a real lookup failure,
        // not a missing leaf — never swallow it into the walk-up path.
        if (e instanceof RealpathError) throw e;
        // Only ENOENT proves the leaf is missing; anything else fails closed.
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") return null;
      }

      return nodePath.join(parentCanon, nodePath.basename(realPath));
    }
    const failure = toRealpathError(e);
    if (failure) throw failure;
    return null;
  }
}

// Bound both recursion and total work. Checking the physical and normalized
// target paths can otherwise revisit the same chain many times.
const MAX_SYMLINK_TRAVERSALS = 40;
const MAX_CONTAINMENT_STEPS = 1024;

/**
 * Check whether a failed realpath(3) lookup stayed inside the sandbox root
 * and complied with the symlink policy, so its errno may be surfaced to
 * the caller instead of the generic sandbox rejection.
 *
 * Node first follows each symlink with a physical stat, then normalizes its
 * target and restarts its own walk. Check both paths so a target such as
 * `escape/../missing` cannot hide an outside lookup. An absolute target using
 * a noncanonical root alias fails closed.
 */
export function isRealpathFailureInsideSandbox(
  pathRelativeToRoot: string,
  canonicalRoot: string,
  allowSymlinks: boolean,
): boolean {
  if (
    nodePath.isAbsolute(pathRelativeToRoot) ||
    (nodePath.sep === "\\" && nodePath.win32.parse(pathRelativeToRoot).root)
  ) {
    return false;
  }
  const path = nodePath.resolve(canonicalRoot, pathRelativeToRoot);
  if (!isPathWithinRoot(path, canonicalRoot)) return false;
  return (
    isLookupInsideSandbox(
      canonicalRoot,
      nodePath.relative(canonicalRoot, path).split(nodePath.sep),
      canonicalRoot,
      allowSymlinks,
      new Set<string>(),
      { remaining: MAX_CONTAINMENT_STEPS },
    ) !== "outside"
  );
}

function getLookupTarget(
  link: string,
  canonicalRoot: string,
): { base: string; components: string[]; normalized: string } | null {
  let target: string;
  try {
    target = fs.readlinkSync(link);
  } catch {
    return null;
  }
  if (nodePath.sep === "\\") target = target.replaceAll("/", "\\");
  let base = nodePath.dirname(link);
  const normalized = nodePath.resolve(base, target);
  if (nodePath.isAbsolute(target)) {
    const rootPrefix = canonicalRoot.endsWith(nodePath.sep)
      ? canonicalRoot
      : `${canonicalRoot}${nodePath.sep}`;
    const comparableTarget =
      nodePath.sep === "\\" ? target.toLowerCase() : target;
    const comparableRoot =
      nodePath.sep === "\\" ? canonicalRoot.toLowerCase() : canonicalRoot;
    const comparablePrefix =
      nodePath.sep === "\\" ? rootPrefix.toLowerCase() : rootPrefix;
    if (comparableTarget === comparableRoot) {
      target = "";
    } else if (comparableTarget.startsWith(comparablePrefix)) {
      target = target.slice(rootPrefix.length);
    } else {
      return null;
    }
    base = canonicalRoot;
  } else if (nodePath.sep === "\\" && nodePath.win32.parse(target).root) {
    // Drive-relative paths do not resolve relative to the link's parent.
    return null;
  }
  return { base, components: target.split(nodePath.sep), normalized };
}

/**
 * Walk a symlink target in OS lookup order. Unlike lexical normalization,
 * `..` here applies after all preceding symlinks have resolved.
 */
function resolvePhysicalLookup(
  current: string,
  components: string[],
  canonicalRoot: string,
  allowSymlinks: boolean,
  seen: Set<string>,
  budget: { remaining: number },
): "outside" | "stopped" | { path: string; directory: boolean } {
  let directory = true;
  for (const part of components) {
    if (--budget.remaining < 0) return "outside";
    if (!directory) return "stopped";
    if (part === "" || part === ".") continue;
    current =
      part === ".." ? nodePath.dirname(current) : nodePath.join(current, part);
    if (!isPathWithinRoot(current, canonicalRoot)) return "outside";
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(current);
    } catch {
      return "stopped";
    }
    if (!stat.isSymbolicLink()) {
      directory = stat.isDirectory();
      continue;
    }
    if (!allowSymlinks) return "outside";
    if (seen.has(current)) return "stopped";
    if (seen.size >= MAX_SYMLINK_TRAVERSALS) return "outside";
    const target = getLookupTarget(current, canonicalRoot);
    if (!target) return "outside";
    seen.add(current);
    const resolved = resolvePhysicalLookup(
      target.base,
      target.components,
      canonicalRoot,
      allowSymlinks,
      seen,
      budget,
    );
    seen.delete(current);
    if (typeof resolved === "string") return resolved;
    current = resolved.path;
    directory = resolved.directory;
  }
  return { path: current, directory };
}

function isLookupInsideSandbox(
  current: string,
  components: string[],
  canonicalRoot: string,
  allowSymlinks: boolean,
  seen: Set<string>,
  budget: { remaining: number },
): "outside" | "stopped" | "resolved" {
  for (let index = 0; index < components.length; index++) {
    const part = components[index];
    if (--budget.remaining < 0) return "outside";
    if (part === "" || part === ".") continue;
    current = nodePath.join(current, part);
    if (!isPathWithinRoot(current, canonicalRoot)) return "outside";
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(current);
    } catch {
      return "stopped";
    }
    if (!stat.isSymbolicLink()) continue;
    if (!allowSymlinks) return "outside";
    if (seen.has(current)) {
      // A repeated link with a remaining suffix can normalize to a new path.
      return components.length === index + 1 ? "stopped" : "outside";
    }
    if (seen.size >= MAX_SYMLINK_TRAVERSALS) return "outside";
    const target = getLookupTarget(current, canonicalRoot);
    if (!target) return "outside";
    seen.add(current);

    // realpathSync first stats the link in OS lookup order, then restarts
    // with a normalized target and the remaining path.
    const physical = resolvePhysicalLookup(
      target.base,
      target.components,
      canonicalRoot,
      allowSymlinks,
      seen,
      budget,
    );
    if (physical === "outside") return "outside";
    const normalized = nodePath.resolve(
      target.normalized,
      components.slice(index + 1).join(nodePath.sep),
    );
    if (!isPathWithinRoot(normalized, canonicalRoot)) return "outside";
    const result = isLookupInsideSandbox(
      canonicalRoot,
      nodePath.relative(canonicalRoot, normalized).split(nodePath.sep),
      canonicalRoot,
      allowSymlinks,
      seen,
      budget,
    );
    seen.delete(current);
    if (result === "outside") return result;
    // An unresolved physical lookup may still be followed by a lexical
    // normalization in a caller. Reject unless that walk also stopped.
    if (physical === "stopped" && result !== "stopped") return "outside";
    return result;
  }
  return "resolved";
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

// Re-export sanitizeErrorMessage from its own module (no node:fs dependency)
// so existing callers that import from real-fs-utils.ts continue to work.
export { sanitizeErrorMessage } from "./sanitize-error.js";

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
    const relativePath =
      resolved.slice(canonicalRoot.length).replace(/\\/g, "/") || "/";
    return { withinRoot: true, relativePath };
  }

  // Outside root - return just the basename to avoid leaking real paths
  return { withinRoot: false, safeName: nodePath.basename(rawTarget) };
}

/**
 * Sanitize an error thrown during real-FS operations to prevent leaking
 * real OS paths.  Node.js ErrnoException objects contain a `.path` property
 * with the real filesystem path — this must never reach the sandbox user.
 *
 * Errors whose `.path` is `undefined` are our own errors (constructed with
 * `new Error(...)`) rather than Node.js ErrnoExceptions.  If their message
 * contains one of `passthroughPatterns`, they are rethrown as-is (they
 * already contain safe virtual paths).  All other errors are replaced with
 * a generic `"CODE: operation 'virtualPath'"` message.
 */
export function sanitizeFsError(
  e: unknown,
  virtualPath: string,
  operation: string,
  passthroughPatterns: readonly string[],
): never {
  const err = e as NodeJS.ErrnoException;
  if (err.path === undefined) {
    for (const pat of passthroughPatterns) {
      if (err.message?.includes(pat)) {
        throw e;
      }
    }
  }
  const code = err.code || "EIO";
  throw new Error(`${code}: ${operation} '${virtualPath}'`);
}
