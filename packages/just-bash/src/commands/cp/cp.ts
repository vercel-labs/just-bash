import { isSameOrDescendantPath } from "../../fs/path-utils.js";
import {
  compareCanonicalContainment,
  compareFileIdentity,
  FileTraversalBudget,
  traverseFileTree,
} from "../../fs/traversal.js";
import {
  ExecutionAbortedError,
  ExecutionLimitError,
} from "../../interpreter/errors.js";
import {
  getErrorCode,
  getErrorMessage,
} from "../../interpreter/helpers/errors.js";
import type {
  ExecResult,
  RuntimeCommand,
  RuntimeCommandContext,
} from "../../types.js";
import { parseArgs } from "../../utils/args.js";
import { hasHelpFlag, showHelp } from "../help.js";

const cpHelp = {
  name: "cp",
  summary: "copy files and directories",
  usage: "cp [OPTION]... SOURCE... DEST",
  options: [
    "-r, -R, --recursive  copy directories recursively",
    "-f, --force          if an existing destination file cannot be opened,",
    "                     remove it and try again (ignored with -n)",
    "-n, --no-clobber     do not overwrite an existing file",
    "-p, --preserve       preserve file attributes",
    "-v, --verbose        explain what is being done",
    "    --help           display this help and exit",
  ],
};

const PERMISSION_DENIED_CODES = new Set(["EACCES", "EPERM"]);

function isPermissionDenied(error: unknown): boolean {
  const code = getErrorCode(error);
  return code !== undefined && PERMISSION_DENIED_CODES.has(code);
}

/**
 * Whether a failed copy is one that `cp -f` answers by replacing the
 * destination. GNU cp does so after any failure to open the destination
 * except ENOENT. The filesystem reports such a failure with a bare errno,
 * `CODE: cp 'path'` (see `sanitizeFsError`), while its own refusals, such as
 * a sandbox or identity check, give a reason after the code and are not
 * retried.
 */
function isRetriableCopyError(error: unknown): boolean {
  const code = getErrorCode(error);
  return (
    code !== undefined &&
    code !== "ENOENT" &&
    /^E[A-Z]+: cp '/.test(getErrorMessage(error))
  );
}

const argDefs = {
  recursive: { short: "r", long: "recursive", type: "boolean" as const },
  recursiveUpper: { short: "R", type: "boolean" as const },
  force: { short: "f", long: "force", type: "boolean" as const },
  noClobber: { short: "n", long: "no-clobber", type: "boolean" as const },
  preserve: { short: "p", long: "preserve", type: "boolean" as const },
  verbose: { short: "v", long: "verbose", type: "boolean" as const },
};

export const cpCommand: RuntimeCommand = {
  name: "cp",

  async execute(
    args: string[],
    ctx: RuntimeCommandContext,
  ): Promise<ExecResult> {
    if (hasHelpFlag(args)) {
      return showHelp(cpHelp);
    }

    const parsed = parseArgs("cp", args, argDefs);
    if (!parsed.ok) return parsed.error;

    const recursive =
      parsed.result.flags.recursive || parsed.result.flags.recursiveUpper;
    const noClobber = parsed.result.flags.noClobber;
    // With -n an existing destination is never touched, so -f has nothing to
    // do; the no-clobber check below runs first and wins in either order.
    const force = parsed.result.flags.force && !noClobber;
    const preserve = parsed.result.flags.preserve;
    const verbose = parsed.result.flags.verbose;
    const paths = parsed.result.positional;

    if (paths.length < 2) {
      return {
        stdout: "",
        stderr: "cp: missing destination file operand\n",
        exitCode: 1,
      };
    }

    const dest = paths.pop() ?? "";
    const sources = paths;
    const destPath = ctx.fs.resolvePath(ctx.cwd, dest);

    let stdout = "";
    let stderr = "";
    let exitCode = 0;
    const traversalBudget = new FileTraversalBudget({
      limits: ctx.limits,
      signal: ctx.signal,
      executionScope: ctx.executionScope,
      site: "cp",
    });

    // Check if dest is a directory
    let destIsDir = false;
    try {
      const stat = await ctx.fs.stat(destPath);
      destIsDir = stat.isDirectory;
    } catch {
      // Dest doesn't exist
    }

    // If multiple sources, dest must be a directory
    if (sources.length > 1 && !destIsDir) {
      return {
        stdout: "",
        stderr: `cp: target '${dest}' is not a directory\n`,
        exitCode: 1,
      };
    }

    for (const src of sources) {
      try {
        const srcPath = ctx.fs.resolvePath(ctx.cwd, src);
        const srcStat = await ctx.fs.stat(srcPath);

        let targetPath = destPath;
        if (destIsDir) {
          const basename = src.split("/").pop() || src;
          targetPath =
            destPath === "/" ? `/${basename}` : `${destPath}/${basename}`;
        }

        if (srcStat.isDirectory && !recursive) {
          stderr += `cp: -r not specified; omitting directory '${src}'\n`;
          exitCode = 1;
          continue;
        }
        if (srcStat.isDirectory) {
          const containment = await compareCanonicalContainment(
            ctx.fs,
            srcPath,
            targetPath,
            traversalBudget,
          );
          if (
            isSameOrDescendantPath(srcPath, targetPath) ||
            containment === "inside"
          ) {
            stderr += `cp: cannot copy '${src}' into itself, '${targetPath}'\n`;
            exitCode = 1;
            continue;
          }
          if (containment === "unknown") {
            stderr += `cp: cannot safely determine whether '${targetPath}' is inside '${src}'\n`;
            exitCode = 1;
            continue;
          }
        }

        // A no-clobber skip performs no destructive operation and therefore
        // does not require proving the identity of the existing target.
        if (noClobber) {
          try {
            await ctx.fs.stat(targetPath);
            continue;
          } catch {
            // Target doesn't exist, proceed with copy.
          }
        }

        const identity = await compareFileIdentity(ctx.fs, srcPath, targetPath);
        if (identity === "same") {
          stderr += `cp: '${src}' and '${targetPath}' are the same file\n`;
          exitCode = 1;
          continue;
        }
        if (identity === "unknown") {
          stderr += `cp: cannot safely determine whether '${src}' and '${targetPath}' are the same file\n`;
          exitCode = 1;
          continue;
        }

        if (srcStat.isDirectory) {
          await traverseFileTree(
            {
              fs: ctx.fs,
              root: srcPath,
              limits: ctx.limits,
              signal: ctx.signal,
              executionScope: ctx.executionScope,
              site: "cp",
              symlinks: "never",
              budget: traversalBudget,
            },
            () => undefined,
          );
        }

        let removedTarget = false;
        try {
          await ctx.fs.cp(srcPath, targetPath, { recursive });
        } catch (error) {
          if (
            !force ||
            srcStat.isDirectory ||
            !isRetriableCopyError(error) ||
            !(await isReplaceableFile(ctx, targetPath))
          ) {
            throw error;
          }
          // GNU cp opens the source before it gives up on the destination, so
          // a source that cannot be read must leave the destination in place.
          // The filesystem API has no access() check, so read the source. A
          // read limit such as maxFileReadSize does not apply to fs.cp, so
          // only that failure is ignored.
          try {
            await ctx.fs.readFileBuffer(srcPath);
          } catch (readError) {
            if (isPermissionDenied(readError)) {
              stderr += `cp: cannot open '${src}' for reading: Permission denied\n`;
              exitCode = 1;
              continue;
            }
            if (getErrorCode(readError) !== "EFBIG") throw readError;
          }
          try {
            await ctx.fs.rm(targetPath);
          } catch (rmError) {
            const reason = isPermissionDenied(rmError)
              ? "Permission denied"
              : getErrorMessage(rmError);
            stderr += `cp: cannot remove '${targetPath}': ${reason}\n`;
            exitCode = 1;
            continue;
          }
          removedTarget = true;
          await ctx.fs.cp(srcPath, targetPath, { recursive });
        }

        // Note: preserve flag is accepted but timestamps are not actually preserved
        // in the virtual filesystem (the fs.cp doesn't support preserving metadata)
        if (preserve) {
          // Silently accepted - would preserve timestamps in real implementation
        }

        if (verbose) {
          stdout += `'${src}' -> '${targetPath}'\n`;
          if (removedTarget) stdout += `removed '${targetPath}'\n`;
        }
      } catch (error) {
        if (
          error instanceof ExecutionLimitError ||
          error instanceof ExecutionAbortedError
        ) {
          throw error;
        }
        const message = getErrorMessage(error);
        if (message.includes("ENOENT") || message.includes("no such file")) {
          stderr += `cp: cannot stat '${src}': No such file or directory\n`;
        } else {
          stderr += `cp: cannot copy '${src}': ${message}\n`;
        }
        exitCode = 1;
      }
    }

    return { stdout, stderr, exitCode };
  },
};

/**
 * Whether `cp -f` may remove the destination: it must be an existing regular
 * file or symlink, inspected without following it. Special files such as
 * FIFOs are refused by the filesystem itself, and GNU cp never removes them.
 */
async function isReplaceableFile(
  ctx: RuntimeCommandContext,
  path: string,
): Promise<boolean> {
  try {
    const stat = await ctx.fs.lstat(path);
    return stat.isFile || stat.isSymbolicLink;
  } catch {
    return false;
  }
}

import type { CommandFuzzInfo } from "../fuzz-flags-types.js";

export const flagsForFuzzing: CommandFuzzInfo = {
  name: "cp",
  flags: [
    { flag: "-r", type: "boolean" },
    { flag: "-R", type: "boolean" },
    { flag: "-f", type: "boolean" },
    { flag: "-n", type: "boolean" },
    { flag: "-p", type: "boolean" },
    { flag: "-v", type: "boolean" },
  ],
  needsArgs: true,
  minArgs: 2,
};
