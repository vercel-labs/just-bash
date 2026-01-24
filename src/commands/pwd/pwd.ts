import type { Command, CommandContext, ExecResult } from "../../types.js";

export const pwdCommand: Command = {
  name: "pwd",

  async execute(args: string[], ctx: CommandContext): Promise<ExecResult> {
    // Parse options
    let usePhysical = false;

    for (const arg of args) {
      if (arg === "-P") {
        usePhysical = true;
      } else if (arg === "-L") {
        usePhysical = false;
      } else if (arg === "--") {
        // End of options
        break;
      } else if (arg.startsWith("-")) {
      }
    }

    let pwd = ctx.cwd;

    if (usePhysical) {
      // -P: resolve all symlinks to get physical path
      try {
        pwd = await ctx.fs.realpath(ctx.cwd);
      } catch {
        // If realpath fails, fall back to current cwd
        // This matches bash behavior
      }
    }

    return {
      stdout: `${pwd}\n`,
      stderr: "",
      exitCode: 0,
    };
  },
};
