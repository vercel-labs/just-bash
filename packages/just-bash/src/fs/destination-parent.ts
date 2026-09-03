import type { FsStat, IFileSystem } from "./interface.js";
import { dirname } from "./path-utils.js";

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
): Promise<"ENOENT" | "ENOTDIR" | undefined> {
  let ancestorPath = dirname(parentPath);

  while (true) {
    try {
      const ancestorStat = await filesystem.stat(ancestorPath);
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

export async function assertDestinationParentDirectory(
  filesystem: Pick<IFileSystem, "stat">,
  destinationPath: string,
): Promise<void> {
  const parentPath = dirname(destinationPath);
  let parentStat: FsStat;
  try {
    parentStat = await filesystem.stat(parentPath);
  } catch (error) {
    const missingParentKnown = errorHasCode(error, "ENOENT");
    if (missingParentKnown || errorHasCode(error, "EACCES")) {
      const code = await classifyParentLookupFailure(
        filesystem,
        parentPath,
        missingParentKnown,
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
