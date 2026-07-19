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
import { getErrorMessage } from "../../interpreter/helpers/errors.js";
import type { Command, CommandContext, ExecResult } from "../../types.js";
import { parseArgs } from "../../utils/args.js";
import { hasHelpFlag, showHelp } from "../help.js";

const mvHelp = {
  name: "mv",
  summary: "move (rename) files",
  usage: "mv [OPTION]... SOURCE... DEST",
  options: [
    "-f, --force       do not prompt before overwriting",
    "-n, --no-clobber  do not overwrite an existing file",
    "-v, --verbose     explain what is being done",
    "    --help        display this help and exit",
  ],
};

const argDefs = {
  force: { short: "f", long: "force", type: "boolean" as const },
  noClobber: { short: "n", long: "no-clobber", type: "boolean" as const },
  verbose: { short: "v", long: "verbose", type: "boolean" as const },
};

export const mvCommand: Command = {
  name: "mv",

  async execute(args: string[], ctx: CommandContext): Promise<ExecResult> {
    if (hasHelpFlag(args)) {
      return showHelp(mvHelp);
    }

    const parsed = parseArgs("mv", args, argDefs);
    if (!parsed.ok) return parsed.error;

    let force = parsed.result.flags.force;
    const noClobber = parsed.result.flags.noClobber;
    const verbose = parsed.result.flags.verbose;
    const paths = parsed.result.positional;

    // -n takes precedence over -f (per GNU coreutils behavior)
    if (noClobber) {
      force = false;
    }

    if (paths.length < 2) {
      return {
        stdout: "",
        stderr: "mv: missing destination file operand\n",
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
      site: "mv",
    });

    // Note: force is accepted but not used since we don't prompt
    void force;

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
        stderr: `mv: target '${dest}' is not a directory\n`,
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
        if (
          srcStat.isDirectory &&
          (isSameOrDescendantPath(srcPath, targetPath) ||
            (await compareCanonicalContainment(
              ctx.fs,
              srcPath,
              targetPath,
              traversalBudget,
            )) === "inside")
        ) {
          stderr += `mv: cannot move '${src}' into itself, '${targetPath}'\n`;
          exitCode = 1;
          continue;
        }
        if (
          (await compareFileIdentity(ctx.fs, srcPath, targetPath)) === "same"
        ) {
          // POSIX rename of a file onto itself succeeds without changing it.
          continue;
        }
        // Check if target exists for -n flag
        if (noClobber) {
          try {
            await ctx.fs.stat(targetPath);
            // Target exists and -n is set, skip this file silently
            continue;
          } catch {
            // Target doesn't exist, proceed with move
          }
        }

        if (srcStat.isDirectory) {
          await traverseFileTree(
            {
              fs: ctx.fs,
              root: srcPath,
              limits: ctx.limits,
              signal: ctx.signal,
              executionScope: ctx.executionScope,
              site: "mv",
              symlinks: "never",
              budget: traversalBudget,
            },
            () => undefined,
          );
        }

        await ctx.fs.mv(srcPath, targetPath);

        if (verbose) {
          const targetName = destIsDir
            ? `${dest}/${src.split("/").pop() || src}`
            : dest;
          stdout += `renamed '${src}' -> '${targetName}'\n`;
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
          stderr += `mv: cannot stat '${src}': No such file or directory\n`;
        } else {
          stderr += `mv: cannot move '${src}': ${message}\n`;
        }
        exitCode = 1;
      }
    }

    return { stdout, stderr, exitCode };
  },
};

import type { CommandFuzzInfo } from "../fuzz-flags-types.js";

export const flagsForFuzzing: CommandFuzzInfo = {
  name: "mv",
  flags: [
    { flag: "-f", type: "boolean" },
    { flag: "-n", type: "boolean" },
    { flag: "-v", type: "boolean" },
  ],
  needsArgs: true,
  minArgs: 2,
};
