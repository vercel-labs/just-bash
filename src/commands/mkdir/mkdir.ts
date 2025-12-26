import { getErrorMessage } from "../../interpreter/helpers/errors.js";
import type { Command, CommandContext, ExecResult } from "../../types.js";
import { unknownOption } from "../help.js";

export const mkdirCommand: Command = {
  name: "mkdir",

  async execute(args: string[], ctx: CommandContext): Promise<ExecResult> {
    let recursive = false;
    let verbose = false;
    const dirs: string[] = [];

    // Parse arguments
    for (const arg of args) {
      if (arg === "-p" || arg === "--parents") {
        recursive = true;
      } else if (arg === "-v" || arg === "--verbose") {
        verbose = true;
      } else if (arg.startsWith("--")) {
        return unknownOption("mkdir", arg);
      } else if (arg.startsWith("-")) {
        for (const c of arg.slice(1)) {
          if (c === "p") recursive = true;
          else if (c === "v") verbose = true;
          else return unknownOption("mkdir", `-${c}`);
        }
      } else {
        dirs.push(arg);
      }
    }

    if (dirs.length === 0) {
      return {
        stdout: "",
        stderr: "mkdir: missing operand\n",
        exitCode: 1,
      };
    }

    let stdout = "";
    let stderr = "";
    let exitCode = 0;

    for (const dir of dirs) {
      try {
        const fullPath = ctx.fs.resolvePath(ctx.cwd, dir);
        await ctx.fs.mkdir(fullPath, { recursive });
        if (verbose) {
          stdout += `mkdir: created directory '${dir}'\n`;
        }
      } catch (error) {
        const message = getErrorMessage(error);
        if (message.includes("ENOENT") || message.includes("no such file")) {
          stderr += `mkdir: cannot create directory '${dir}': No such file or directory\n`;
        } else if (
          message.includes("EEXIST") ||
          message.includes("already exists")
        ) {
          stderr += `mkdir: cannot create directory '${dir}': File exists\n`;
        } else {
          stderr += `mkdir: cannot create directory '${dir}': ${message}\n`;
        }
        exitCode = 1;
      }
    }

    return { stdout, stderr, exitCode };
  },
};
