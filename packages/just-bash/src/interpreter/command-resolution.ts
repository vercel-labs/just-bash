/**
 * Command Resolution
 *
 * Handles PATH-based command resolution and lookup for external commands.
 */

import type { FsStat, IFileSystem } from "../fs/interface.js";
import type { Command, CommandRegistry } from "../types.js";
import type { InterpreterState } from "./types.js";

/**
 * Context needed for command resolution
 */
export interface CommandResolutionContext {
  fs: IFileSystem;
  state: InterpreterState;
  commands: CommandRegistry;
}

/**
 * Result type for command resolution
 */
export type ResolveCommandResult =
  | { cmd: Command; path: string }
  | { script: true; path: string }
  | {
      error: "not_found" | "permission_denied";
      path?: string;
      /** The path as bash reports it: formed from the PATH entry, or as typed */
      displayPath?: string;
    }
  | null;

/**
 * A file that a PATH search found for a name.
 */
export interface PathMatch {
  /** Absolute path of the file */
  path: string;
  /** Path formed from the PATH entry, as bash reports it */
  displayPath: string;
  /** Registered command whose stub the file is */
  cmd?: Command;
  /** Whether the file can run: an executable or a registered command's stub */
  executable: boolean;
}

function isTrustedCommandStub(path: string, commandName: string): boolean {
  return path === `/bin/${commandName}` || path === `/usr/bin/${commandName}`;
}

/**
 * Content of the file that stands for a registered command in /bin and
 * /usr/bin, so that PATH lookups find it.
 */
export function commandStubContent(commandName: string): string {
  return `#!/bin/bash\n# Built-in command: ${commandName}\n`;
}

/**
 * Whether a file is the stub of a command that this shell does not register,
 * such as one another Bash instance wrote to a shared filesystem. Such a stub
 * stands for a command that is not provided here, so lookups treat it as
 * absent rather than as a script or a file without execute permission.
 */
async function isUnregisteredCommandStub(
  ctx: CommandResolutionContext,
  path: string,
  commandName: string,
  stat: FsStat,
): Promise<boolean> {
  if (
    ctx.commands.has(commandName) ||
    !isTrustedCommandStub(path, commandName) ||
    !stat.isFile
  ) {
    return false;
  }
  const stub = commandStubContent(commandName);
  if (stat.size !== stub.length) {
    return false;
  }
  try {
    return (await ctx.fs.readFile(path)) === stub;
  } catch {
    return false;
  }
}

/**
 * Search PATH for a name the way bash does: the first executable file wins,
 * a registered command's stub counts as executable, and when no file can run,
 * the first one found without execute permission is returned so that running
 * it fails with "Permission denied". Directories and stubs of commands this
 * shell does not register are skipped.
 */
export async function searchPath(
  ctx: CommandResolutionContext,
  commandName: string,
  pathOverride?: string,
): Promise<PathMatch | null> {
  const pathEnv = pathOverride ?? ctx.state.env.get("PATH") ?? "/usr/bin:/bin";
  const cmd = ctx.commands.get(commandName);
  let denied: PathMatch | null = null;

  for (const dir of pathEnv.split(":")) {
    if (!dir) continue;
    // Resolve relative PATH directories against cwd
    const resolvedDir = dir.startsWith("/")
      ? dir
      : ctx.fs.resolvePath(ctx.state.cwd, dir);
    const path = `${resolvedDir}/${commandName}`;
    const displayPath = `${dir}/${commandName}`;
    let stat: FsStat;
    try {
      if (!(await ctx.fs.exists(path))) continue;
      stat = await ctx.fs.stat(path);
    } catch {
      continue;
    }
    if (stat.isDirectory) continue;

    // Registered commands in system directories work without execute bits
    // (they're our internal implementations with stub files)
    if (cmd && isTrustedCommandStub(path, commandName)) {
      return { path, displayPath, cmd, executable: true };
    }
    if (await isUnregisteredCommandStub(ctx, path, commandName, stat)) {
      continue;
    }
    // Any other executable is a user script, even when it shares a
    // registered command's name
    if ((stat.mode & 0o111) !== 0) {
      return { path, displayPath, executable: true };
    }
    denied ??= { path, displayPath, executable: false };
  }

  return denied;
}

/**
 * Resolve a command name to its implementation via PATH lookup.
 * Returns the command and its resolved path, or null if not found.
 *
 * Resolution order:
 * 1. If command contains "/", resolve as a path
 * 2. Search PATH directories for the command file
 * 3. Fall back to registry lookup (for non-InMemoryFs filesystems like OverlayFs)
 */
export async function resolveCommand(
  ctx: CommandResolutionContext,
  commandName: string,
  pathOverride?: string,
): Promise<ResolveCommandResult> {
  // If command contains "/", it's a path - resolve directly
  if (commandName.includes("/")) {
    const resolvedPath = ctx.fs.resolvePath(ctx.state.cwd, commandName);
    // Check if file exists
    if (!(await ctx.fs.exists(resolvedPath))) {
      return { error: "not_found", path: resolvedPath };
    }
    // Check file properties
    try {
      const stat = await ctx.fs.stat(resolvedPath);
      if (stat.isDirectory) {
        // Trying to execute a directory
        return { error: "permission_denied", path: resolvedPath };
      }
      const cmdName = resolvedPath.split("/").pop() || commandName;
      const cmd = ctx.commands.get(cmdName);
      if (cmd && isTrustedCommandStub(resolvedPath, cmdName)) {
        return { cmd, path: resolvedPath };
      }
      // A stub of a command this shell lacks is no command at all
      if (await isUnregisteredCommandStub(ctx, resolvedPath, cmdName, stat)) {
        return { error: "not_found", path: resolvedPath };
      }
      const isExecutable = (stat.mode & 0o111) !== 0;
      if (!isExecutable) {
        // File exists but is not executable - permission denied
        return { error: "permission_denied", path: resolvedPath };
      }
      // Explicit non-system paths always denote the file, never a same-basename
      // registered command.
      return { script: true, path: resolvedPath };
    } catch {
      // If stat fails, treat as not found
      return { error: "not_found", path: resolvedPath };
    }
  }

  // Check hash table first (unless pathOverride is set, which bypasses cache)
  if (!pathOverride && ctx.state.hashTable) {
    const cachedPath = ctx.state.hashTable.get(commandName);
    if (cachedPath) {
      try {
        const stat = await ctx.fs.stat(cachedPath);
        if (!stat.isDirectory) {
          const cmd = ctx.commands.get(commandName);
          if (cmd && isTrustedCommandStub(cachedPath, commandName)) {
            return { cmd, path: cachedPath };
          }
          if (
            (stat.mode & 0o111) !== 0 &&
            !(await isUnregisteredCommandStub(
              ctx,
              cachedPath,
              commandName,
              stat,
            ))
          ) {
            return { script: true, path: cachedPath };
          }
        }
      } catch {
        // Invalid cached entries are evicted before doing a fresh PATH search.
      }
      ctx.state.hashTable.delete(commandName);
    }
  }

  // Search PATH directories (use override if provided, for command -p)
  const match = await searchPath(ctx, commandName, pathOverride);
  if (match?.cmd) {
    return { cmd: match.cmd, path: match.path };
  }
  if (match?.executable) {
    return { script: true, path: match.path };
  }

  // Fallback: check registry directly only if /usr/bin doesn't exist
  // This maintains backward compatibility for OverlayFs and other non-InMemoryFs
  // where command stubs aren't created, while still respecting PATH for InMemoryFs
  const usrBinExists = await ctx.fs.exists("/usr/bin");
  if (!usrBinExists) {
    const cmd = ctx.commands.get(commandName);
    if (cmd) {
      return { cmd, path: `/usr/bin/${commandName}` };
    }
  }

  // Like bash, a name found only without execute permission is reported as
  // permission denied instead of not found.
  if (match) {
    return {
      error: "permission_denied",
      path: match.path,
      displayPath: match.displayPath,
    };
  }
  return null;
}

/**
 * Find all paths for a command in PATH (for `which -a`).
 */
export async function findCommandInPath(
  ctx: CommandResolutionContext,
  commandName: string,
): Promise<string[]> {
  const paths: string[] = [];

  // If command contains /, it's a path - check if it exists and is executable
  if (commandName.includes("/")) {
    const resolvedPath = ctx.fs.resolvePath(ctx.state.cwd, commandName);
    if (await ctx.fs.exists(resolvedPath)) {
      try {
        const stat = await ctx.fs.stat(resolvedPath);
        if (!stat.isDirectory) {
          // Check if file is executable (owner, group, or other execute bit set)
          const isExecutable = (stat.mode & 0o111) !== 0;
          if (isExecutable) {
            // Return the original path format (not resolved) to match bash behavior
            paths.push(commandName);
          }
        }
      } catch {
        // If stat fails, skip
      }
    }
    return paths;
  }

  const pathEnv = ctx.state.env.get("PATH") || "/usr/bin:/bin";
  const pathDirs = pathEnv.split(":");

  for (const dir of pathDirs) {
    if (!dir) continue;
    // Resolve relative PATH entries relative to cwd
    const resolvedDir = dir.startsWith("/")
      ? dir
      : ctx.fs.resolvePath(ctx.state.cwd, dir);
    const fullPath = `${resolvedDir}/${commandName}`;
    // Registered commands model binaries provided by the sandbox's system
    // directories. Report those virtual binaries for `type -a/-P`, while
    // continuing to require a real executable for every user-controlled PATH
    // directory so a same-basename script is never mistaken for a builtin.
    if (
      isTrustedCommandStub(fullPath, commandName) &&
      ctx.commands.has(commandName)
    ) {
      paths.push(fullPath);
      continue;
    }
    if (await ctx.fs.exists(fullPath)) {
      // Check if it's a directory - skip directories
      try {
        const stat = await ctx.fs.stat(fullPath);
        if (
          stat.isDirectory ||
          (stat.mode & 0o111) === 0 ||
          (await isUnregisteredCommandStub(ctx, fullPath, commandName, stat))
        ) {
          continue;
        }
      } catch {
        continue;
      }
      // Return the original path format (relative if relative was given)
      paths.push(dir.startsWith("/") ? fullPath : `${dir}/${commandName}`);
    }
  }

  return paths;
}
