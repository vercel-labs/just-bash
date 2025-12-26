import { getErrorMessage } from "../../interpreter/helpers/errors.js";
import type { Command, CommandContext, ExecResult } from "../../types.js";
import { unknownOption } from "../help.js";

export const rmCommand: Command = {
  name: "rm",

  async execute(args: string[], ctx: CommandContext): Promise<ExecResult> {
    let recursive = false;
    let force = false;
    let verbose = false;
    const paths: string[] = [];

    // Parse arguments
    for (const arg of args) {
      if (arg.startsWith("-") && !arg.startsWith("--")) {
        for (const flag of arg.slice(1)) {
          if (flag === "r" || flag === "R") recursive = true;
          else if (flag === "f") force = true;
          else if (flag === "v") verbose = true;
          else return unknownOption("rm", `-${flag}`);
        }
      } else if (arg === "--recursive") {
        recursive = true;
      } else if (arg === "--force") {
        force = true;
      } else if (arg === "--verbose" || arg === "-v") {
        verbose = true;
      } else if (arg.startsWith("--")) {
        return unknownOption("rm", arg);
      } else {
        paths.push(arg);
      }
    }

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
        if (!force) {
          const message = getErrorMessage(error);
          if (message.includes("ENOENT") || message.includes("no such file")) {
            stderr += `rm: cannot remove '${path}': No such file or directory\n`;
          } else if (
            message.includes("ENOTEMPTY") ||
            message.includes("not empty")
          ) {
            stderr += `rm: cannot remove '${path}': Directory not empty\n`;
          } else {
            stderr += `rm: cannot remove '${path}': ${message}\n`;
          }
          exitCode = 1;
        }
      }
    }

    return { stdout, stderr, exitCode };
  },
};
