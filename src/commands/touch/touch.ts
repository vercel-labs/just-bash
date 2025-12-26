import { getErrorMessage } from "../../interpreter/helpers/errors.js";
import type { Command, CommandContext, ExecResult } from "../../types.js";
import { unknownOption } from "../help.js";

export const touchCommand: Command = {
  name: "touch",

  async execute(args: string[], ctx: CommandContext): Promise<ExecResult> {
    const files: string[] = [];

    // Parse arguments
    for (const arg of args) {
      if (arg.startsWith("--")) {
        return unknownOption("touch", arg);
      } else if (arg.startsWith("-") && arg.length > 1) {
        return unknownOption("touch", arg);
      } else {
        files.push(arg);
      }
    }

    if (files.length === 0) {
      return {
        stdout: "",
        stderr: "touch: missing file operand\n",
        exitCode: 1,
      };
    }

    let stderr = "";
    let exitCode = 0;

    for (const file of files) {
      try {
        const fullPath = ctx.fs.resolvePath(ctx.cwd, file);
        const exists = await ctx.fs.exists(fullPath);

        if (!exists) {
          await ctx.fs.writeFile(fullPath, "");
        }
        // If exists, we'd update timestamp but our FS doesn't track that
      } catch (error) {
        stderr += `touch: cannot touch '${file}': ${getErrorMessage(error)}\n`;
        exitCode = 1;
      }
    }

    return { stdout: "", stderr, exitCode };
  },
};
