import { sanitizeErrorMessage } from "../../fs/sanitize-error.js";
import {
  errnoCode,
  errnoReason,
  getErrorMessage,
} from "../../interpreter/helpers/errors.js";
import type {
  ExecResult,
  RuntimeCommand,
  RuntimeCommandContext,
} from "../../types.js";
import { parseArgs } from "../../utils/args.js";

const argDefs = {
  recursive: { short: "r", long: "recursive", type: "boolean" as const },
  recursiveUpper: { short: "R", type: "boolean" as const },
  force: { short: "f", long: "force", type: "boolean" as const },
  verbose: { short: "v", long: "verbose", type: "boolean" as const },
};

export const rmCommand: RuntimeCommand = {
  name: "rm",

  async execute(
    args: string[],
    ctx: RuntimeCommandContext,
  ): Promise<ExecResult> {
    const parsed = parseArgs("rm", args, argDefs);
    if (!parsed.ok) return parsed.error;

    const recursive =
      parsed.result.flags.recursive || parsed.result.flags.recursiveUpper;
    const force = parsed.result.flags.force;
    const verbose = parsed.result.flags.verbose;
    const paths = parsed.result.positional;

    if (paths.length === 0) {
      if (force) {
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      return {
        stdout: "",
        stderr: "rm: missing operand\n",
        exitCode: 1,
      };
    }

    let stdout = "";
    let stderr = "";
    let exitCode = 0;

    for (const path of paths) {
      try {
        const fullPath = ctx.fs.resolvePath(ctx.cwd, path);
        const stat = await ctx.fs.stat(fullPath);
        if (stat.isDirectory && !recursive) {
          stderr += `rm: cannot remove '${path}': Is a directory\n`;
          exitCode = 1;
          continue;
        }
        await ctx.fs.rm(fullPath, { recursive, force });
        if (verbose) {
          stdout += `removed '${path}'\n`;
        }
      } catch (error) {
        // -f ignores a file that is not there (ENOENT, or ENOTDIR for a path
        // through a file, as GNU rm does) and only that: a file the filesystem
        // refuses to remove (EROFS, EACCES, ...) is an error, and an error that
        // is no errno at all (a limit, a cancellation, a sandbox refusal) is
        // not ours to swallow.
        const refused = errnoReason(error);
        const code = errnoCode(error);
        if (force && (code === "ENOENT" || code === "ENOTDIR")) {
          continue;
        }
        if (force && refused === undefined) throw error;
        if (force && refused !== undefined) {
          stderr += `rm: cannot remove '${path}': ${refused}\n`;
          exitCode = 1;
        } else if (!force) {
          const message = getErrorMessage(error);
          if (message.includes("ENOENT") || message.includes("no such file")) {
            stderr += `rm: cannot remove '${path}': No such file or directory\n`;
          } else if (
            message.includes("ENOTEMPTY") ||
            message.includes("not empty")
          ) {
            stderr += `rm: cannot remove '${path}': Directory not empty\n`;
          } else if (refused !== undefined) {
            stderr += `rm: cannot remove '${path}': ${refused}\n`;
          } else {
            stderr += `rm: cannot remove '${path}': ${sanitizeErrorMessage(message)}\n`;
          }
          exitCode = 1;
        }
      }
    }

    return { stdout, stderr, exitCode };
  },
};

import type { CommandFuzzInfo } from "../fuzz-flags-types.js";

export const flagsForFuzzing: CommandFuzzInfo = {
  name: "rm",
  flags: [
    { flag: "-r", type: "boolean" },
    { flag: "-R", type: "boolean" },
    { flag: "-f", type: "boolean" },
    { flag: "-v", type: "boolean" },
  ],
  needsArgs: true,
};
