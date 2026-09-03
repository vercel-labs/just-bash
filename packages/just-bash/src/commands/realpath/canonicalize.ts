import type { FsStat, IFileSystem } from "../../fs/interface.js";
import { MAX_SYMLINK_DEPTH } from "../../fs/path-utils.js";
import type { FileTraversalBudget } from "../../fs/traversal.js";
import {
  ExecutionAbortedError,
  ExecutionLimitError,
} from "../../interpreter/errors.js";

/**
 * How much of the path has to exist.
 *
 * - `default`: every component but the last (GNU's default)
 * - `existing`: all of it (`-e`)
 * - `missing`: none of it, and nothing fails (`-m`)
 */
export type ExistencePolicy = "default" | "existing" | "missing";

export interface CanonicalizeOptions {
  existence: ExistencePolicy;
  /** `-s` / `--no-symlinks`: name components stay unexpanded. */
  noSymlinks: boolean;
  /** `-L` / `--logical`: resolve `..` components before symlinks. */
  logical: boolean;
}

export type CanonicalizeFailure = "ENOENT" | "ENOTDIR" | "ELOOP" | "EACCES";

export type CanonicalizeResult =
  | { ok: true; path: string }
  | { ok: false; code: CanonicalizeFailure };

/**
 * Path components, empty segments dropped. `.` is kept: it is not a no-op,
 * because `file/.` has to fail the way `file/x` does.
 */
function splitComponents(path: string): string[] {
  return path.split("/").filter((part) => part !== "");
}

function parentOf(resolved: string): string {
  return resolved.slice(0, resolved.lastIndexOf("/"));
}

/** Limits and cancellation belong to the caller, never to path resolution. */
function rethrowExecutionErrors(error: unknown): void {
  if (
    error instanceof ExecutionLimitError ||
    error instanceof ExecutionAbortedError
  ) {
    throw error;
  }
}

/** The failure realpath reports for a filesystem error, or a missing entry. */
function failureFor(error: unknown): CanonicalizeFailure | "missing" {
  rethrowExecutionErrors(error);
  const message = error instanceof Error ? error.message : String(error);
  switch (/^([A-Z]+):/.exec(message)?.[1]) {
    case "ENOENT":
      return "missing";
    case "ENOTDIR":
      return "ENOTDIR";
    case "ELOOP":
      return "ELOOP";
    case "EACCES":
    case "EPERM":
      return "EACCES";
    default:
      // An unexplained failure must not read as a resolvable name.
      return "ENOENT";
  }
}

/** Stat with symlinks followed; `undefined` when the entry cannot be read. */
async function statFollowing(
  fs: IFileSystem,
  path: string,
): Promise<FsStat | undefined> {
  try {
    return await fs.stat(path === "" ? "/" : path);
  } catch (error) {
    rethrowExecutionErrors(error);
    return undefined;
  }
}

/**
 * Where an absolute symlink target starts.
 *
 * MountableFs stores a mounted filesystem's absolute targets relative to that
 * filesystem's own root, so restarting at the global root would leave the
 * mount and name a different file. Asking the filesystem to resolve the link
 * puts the answer back in the global namespace; every single-root backend
 * returns exactly what restarting at the root produces, and a link the
 * backend cannot resolve (dangling, blocked, looping) falls back to it.
 */
async function absoluteTargetBase(
  fs: IFileSystem,
  linkPath: string,
): Promise<{ resolved: string; consumesTarget: boolean }> {
  try {
    return { resolved: await fs.realpath(linkPath), consumesTarget: true };
  } catch (error) {
    rethrowExecutionErrors(error);
    return { resolved: "", consumesTarget: false };
  }
}

/**
 * Resolve `input` against the filesystem, expanding symlinks as they are
 * encountered unless `noSymlinks` is set.
 */
async function walk(
  fs: IFileSystem,
  cwd: string,
  input: string,
  options: CanonicalizeOptions,
  budget: FileTraversalBudget,
): Promise<CanonicalizeResult> {
  const absolute = input.startsWith("/") ? input : `${cwd}/${input}`;
  const expand = !options.noSymlinks;
  const tolerateMissing = options.existence === "missing";
  // A trailing slash asserts the name is a directory.
  let requireDirectory = input.endsWith("/");

  let queue = splitComponents(absolute);
  let index = 0;
  let resolved = "";
  let depth = 0;
  let symlinkHops = 0;

  /** Whether a component that does not exist ends resolution with ENOENT. */
  const missingIsFatal = (isLast: boolean): boolean => {
    // Without expansion GNU checks no intermediate component; `-e` is left to
    // the existence check on the finished name.
    if (options.noSymlinks) return false;
    if (options.existence === "existing") return true;
    return !isLast;
  };

  while (index < queue.length) {
    const component = queue[index++];
    budget.visit(depth);

    // `.` only asserts that what precedes it is a directory, which the
    // component before it already checked by seeing a component remaining.
    if (component === ".") continue;

    if (component === "..") {
      resolved = parentOf(resolved);
      depth = Math.max(0, depth - 1);
      continue;
    }

    const candidate = `${resolved}/${component}`;
    const isLast = index === queue.length;
    const needsDirectory = !isLast || requireDirectory;

    let entry: FsStat;
    try {
      entry = await fs.lstat(candidate);
    } catch (error) {
      const failure = failureFor(error);
      if (!tolerateMissing) {
        if (failure !== "missing") return { ok: false, code: failure };
        if (missingIsFatal(isLast)) return { ok: false, code: "ENOENT" };
      }
      resolved = candidate;
      depth++;
      continue;
    }

    if (entry.isSymbolicLink && expand) {
      if (++symlinkHops > MAX_SYMLINK_DEPTH) {
        // `-m` promises never to fail, so a loop leaves the link unexpanded.
        if (!tolerateMissing) return { ok: false, code: "ELOOP" };
        resolved = candidate;
        depth++;
        continue;
      }

      let target: string;
      try {
        target = await fs.readlink(candidate);
      } catch (error) {
        const failure = failureFor(error);
        if (tolerateMissing) {
          resolved = candidate;
          depth++;
          continue;
        }
        return { ok: false, code: failure === "missing" ? "ENOENT" : failure };
      }

      const remaining = queue.length - index;
      // A target ending in a slash carries the directory requirement, but
      // only when the link is the last thing being named.
      if (remaining === 0 && target.endsWith("/")) requireDirectory = true;

      const targetComponents = splitComponents(target);
      // Charge the expanded path before allocating it, so an oversized target
      // trips the traversal budget instead of the allocator.
      budget.checkpoint(targetComponents.length + remaining);

      if (target.startsWith("/")) {
        const base = await absoluteTargetBase(fs, candidate);
        resolved = base.resolved;
        depth = splitComponents(resolved).length;
        if (base.consumesTarget) {
          // The filesystem resolved the whole link, so the target components
          // are already accounted for; only the directory test is left.
          if (needsDirectory && !tolerateMissing) {
            const followed = await statFollowing(fs, resolved);
            if (followed !== undefined && !followed.isDirectory) {
              return { ok: false, code: "ENOTDIR" };
            }
          }
          queue = queue.slice(index);
          index = 0;
          continue;
        }
      }

      queue = targetComponents.concat(queue.slice(index));
      index = 0;
      continue;
    }

    resolved = candidate;
    depth++;

    // An unexpanded symlink is still followed for the directory test: that is
    // how GNU makes `realpath -s link/x` ENOTDIR while `-s dirlink/x` passes.
    const followed =
      entry.isSymbolicLink && !expand
        ? await statFollowing(fs, candidate)
        : entry;

    if (
      needsDirectory &&
      !tolerateMissing &&
      followed !== undefined &&
      !followed.isDirectory
    ) {
      return { ok: false, code: "ENOTDIR" };
    }
  }

  const path = resolved === "" ? "/" : resolved;

  // Nothing above checked existence when components are left unexpanded.
  if (options.noSymlinks && options.existence === "existing") {
    if ((await statFollowing(fs, path)) === undefined) {
      return { ok: false, code: "ENOENT" };
    }
  }

  return { ok: true, path };
}

/**
 * Cancel `X/..` pairs before any symlink is expanded (`-L`), which is only
 * allowed when `X` is an existing directory — GNU rejects `-L link/..` for a
 * link to a file and `-L nosuch/..` for a name that is not there.
 */
async function canonicalizeLogical(
  fs: IFileSystem,
  cwd: string,
  input: string,
  options: CanonicalizeOptions,
  budget: FileTraversalBudget,
): Promise<CanonicalizeResult> {
  const absolute = input.startsWith("/") ? input : `${cwd}/${input}`;
  const physical: CanonicalizeOptions = { ...options, logical: false };
  const kept: string[] = [];

  const requireDirectoryPrefix = async (): Promise<CanonicalizeResult> => {
    if (options.existence === "missing") return { ok: true, path: "" };
    // The trailing slash makes the prefix a directory requirement, and
    // `existing` makes its absence an error.
    return walk(
      fs,
      cwd,
      `/${kept.join("/")}/`,
      { ...physical, existence: "existing" },
      budget,
    );
  };

  for (const component of splitComponents(absolute)) {
    budget.visit(kept.length);

    if (component !== "." && component !== "..") {
      kept.push(component);
      continue;
    }

    // `..` at the root is the root, and needs no directory above it.
    if (component === ".." && kept.length === 0) continue;

    const prefix = await requireDirectoryPrefix();
    if (!prefix.ok) return prefix;
    if (component === "..") kept.pop();
  }

  const logicalPath = `/${kept.join("/")}${
    input.endsWith("/") && kept.length > 0 ? "/" : ""
  }`;
  return walk(fs, cwd, logicalPath, physical, budget);
}

/**
 * Resolve `input` to an absolute path the way GNU `realpath` does.
 *
 * Components are walked one at a time rather than handed to `fs.realpath()`
 * so that `-e`/`-m`, `-s` and `-L` can each apply their own existence and
 * symlink policy, and so a failure can be reported with the errno GNU prints.
 */
export async function canonicalize(
  fs: IFileSystem,
  cwd: string,
  input: string,
  options: CanonicalizeOptions,
  budget: FileTraversalBudget,
): Promise<CanonicalizeResult> {
  if (input === "") {
    // GNU rejects the empty name outright, in every mode.
    return { ok: false, code: "ENOENT" };
  }
  return options.logical
    ? canonicalizeLogical(fs, cwd, input, options, budget)
    : walk(fs, cwd, input, options, budget);
}
