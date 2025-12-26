import { getErrorMessage } from "../../interpreter/helpers/errors.js";
import type { Command, CommandContext, ExecResult } from "../../types.js";
import { hasHelpFlag, showHelp, unknownOption } from "../help.js";

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

export const mvCommand: Command = {
  name: "mv",

  async execute(args: string[], ctx: CommandContext): Promise<ExecResult> {
    if (hasHelpFlag(args)) {
      return showHelp(mvHelp);
    }

    let force = false;
    let noClobber = false;
    let verbose = false;
    const paths: string[] = [];

    // Parse arguments
    for (const arg of args) {
      if (arg === "-f" || arg === "--force") {
        force = true;
      } else if (arg === "-n" || arg === "--no-clobber") {
        noClobber = true;
      } else if (arg === "-v" || arg === "--verbose") {
        verbose = true;
      } else if (arg.startsWith("--")) {
        return unknownOption("mv", arg);
      } else if (arg.startsWith("-") && arg.length > 1) {
        // Handle combined flags like -fv
        for (const char of arg.slice(1)) {
          if (char === "f") force = true;
          else if (char === "n") noClobber = true;
          else if (char === "v") verbose = true;
          else return unknownOption("mv", `-${char}`);
        }
      } else {
        paths.push(arg);
      }
    }

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

        let targetPath = destPath;
        if (destIsDir) {
          const basename = src.split("/").pop() || src;
          targetPath =
            destPath === "/" ? `/${basename}` : `${destPath}/${basename}`;
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

        await ctx.fs.mv(srcPath, targetPath);

        if (verbose) {
          const targetName = destIsDir
            ? `${dest}/${src.split("/").pop() || src}`
            : dest;
          stdout += `renamed '${src}' -> '${targetName}'\n`;
        }
      } catch (error) {
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
