import { resolveLimits } from "../limits.js";
import type { FsStat, IFileSystem } from "./interface.js";
import { dirname, joinPath, normalizePath } from "./path-utils.js";
import { FileTraversalBudget } from "./traversal.js";

type FileSystemErrorCode = "EACCES" | "ENOENT" | "ENOTDIR";

export class DestinationParentError extends Error {
  readonly code: "ENOENT" | "ENOTDIR";
  readonly destinationPath: string;
  readonly parentPath: string;

  constructor(
    code: "ENOENT" | "ENOTDIR",
    destinationPath: string,
    parentPath: string,
  ) {
    const description =
      code === "ENOENT" ? "no such file or directory" : "not a directory";
    super(`${code}: ${description}, destination parent '${parentPath}'`);
    this.name = "DestinationParentError";
    this.code = code;
    this.destinationPath = destinationPath;
    this.parentPath = parentPath;
  }
}

function getErrorCode(error: unknown): string | undefined {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  return undefined;
}

function errorHasCode(error: unknown, code: FileSystemErrorCode): boolean {
  if (getErrorCode(error) === code) return true;
  if (!(error instanceof Error)) return false;
  const virtualErrorMessage = error.message;
  return virtualErrorMessage.startsWith(`${code}:`);
}

async function classifyParentLookupFailure(
  filesystem: Pick<IFileSystem, "stat">,
  parentPath: string,
  missingParentKnown: boolean,
  traversalBudget: FileTraversalBudget,
): Promise<"ENOENT" | "ENOTDIR" | undefined> {
  let ancestorPath = dirname(parentPath);

  while (true) {
    traversalBudget.checkpoint();
    try {
      const ancestorStat = await filesystem.stat(ancestorPath);
      traversalBudget.checkpoint(0);
      if (!ancestorStat.isDirectory) return "ENOTDIR";
      return missingParentKnown ? "ENOENT" : undefined;
    } catch (error) {
      if (errorHasCode(error, "ENOTDIR")) return "ENOTDIR";
      if (!errorHasCode(error, "ENOENT") && !errorHasCode(error, "EACCES")) {
        throw error;
      }
    }

    if (ancestorPath === "/") {
      return missingParentKnown ? "ENOENT" : undefined;
    }
    ancestorPath = dirname(ancestorPath);
  }
}

interface DestinationResolutionOptions {
  basePath?: string;
  budget?: FileTraversalBudget;
  /** Directory copies and renames may create the final directory, even with a slash. */
  allowMissingDirectory?: boolean;
}

/**
 * Resolve parents in traversal order, retaining the final directory entry for
 * cp/mv to handle. Callers must use the returned path for identity checks and I/O.
 */
export async function resolveDestinationPath(
  filesystem: Pick<IFileSystem, "stat" | "lstat" | "realpath">,
  destinationPath: string,
  options: DestinationResolutionOptions = {},
): Promise<string> {
  // Direct IFileSystem calls have no command execution scope. Still bound the
  // work of one path lookup, including repeated components canceled by '..'.
  const traversalBudget =
    options.budget ??
    new FileTraversalBudget({
      limits: resolveLimits({ maxTraversalWork: 4096 }),
      site: "destination resolution",
    });
  const absoluteDestinationPath = destinationPath.startsWith("/")
    ? destinationPath
    : joinPath(normalizePath(options.basePath ?? "/"), destinationPath);
  let resolvedPath = "/";
  await assertDirectoryPath(
    filesystem,
    destinationPath,
    resolvedPath,
    traversalBudget,
  );

  // Stream components rather than allocating an array proportional to an
  // untrusted argument before the traversal budget can reject it.
  const pathComponents = absoluteDestinationPath.matchAll(/[^/]+/g);
  let currentComponent = pathComponents.next();
  while (!currentComponent.done) {
    traversalBudget.checkpoint();
    const component = currentComponent.value[0];
    const nextComponent = pathComponents.next();
    if (component === "..") {
      resolvedPath = dirname(resolvedPath);
    } else if (component !== ".") {
      resolvedPath = joinPath(resolvedPath, component);
      if (nextComponent.done) {
        if (destinationPath.endsWith("/")) {
          try {
            await assertDirectoryPath(
              filesystem,
              destinationPath,
              resolvedPath,
              traversalBudget,
            );
          } catch (error) {
            if (
              !(
                options.allowMissingDirectory &&
                error instanceof DestinationParentError &&
                error.code === "ENOENT"
              )
            )
              throw error;
          }
        }
        return resolvedPath;
      }
      await assertDirectoryPath(
        filesystem,
        destinationPath,
        resolvedPath,
        traversalBudget,
      );
      traversalBudget.checkpoint();
      const parentEntry = await filesystem.lstat(resolvedPath);
      traversalBudget.checkpoint(0);
      // Every earlier component is already physical. Plain directory entries
      // need no realpath support; symlinks must be resolved before any '..'.
      if (parentEntry.isSymbolicLink) {
        traversalBudget.checkpoint();
        resolvedPath = await filesystem.realpath(resolvedPath);
        traversalBudget.checkpoint(0);
      }
    }
    currentComponent = nextComponent;
  }
  return resolvedPath;
}

async function assertDirectoryPath(
  filesystem: Pick<IFileSystem, "stat">,
  destinationPath: string,
  parentPath: string,
  traversalBudget: FileTraversalBudget,
): Promise<void> {
  traversalBudget.checkpoint();
  let parentStat: FsStat;
  try {
    parentStat = await filesystem.stat(parentPath);
    traversalBudget.checkpoint(0);
  } catch (error) {
    const missingParentKnown = errorHasCode(error, "ENOENT");
    if (missingParentKnown || errorHasCode(error, "EACCES")) {
      const code = await classifyParentLookupFailure(
        filesystem,
        parentPath,
        missingParentKnown,
        traversalBudget,
      );
      if (!code) throw error;
      throw new DestinationParentError(code, destinationPath, parentPath);
    }
    if (errorHasCode(error, "ENOTDIR")) {
      throw new DestinationParentError("ENOTDIR", destinationPath, parentPath);
    }
    throw error;
  }

  if (!parentStat.isDirectory) {
    throw new DestinationParentError("ENOTDIR", destinationPath, parentPath);
  }
}
