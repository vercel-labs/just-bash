import type { Command, CommandContext, ExecResult } from "../../types.js";
import { parseArgs } from "../../utils/args.js";
import { hasHelpFlag, showHelp } from "../help.js";

const statHelp = {
  name: "stat",
  summary: "display file or file system status",
  usage: "stat [OPTION]... FILE...",
  options: [
    "-c FORMAT   use the specified FORMAT instead of the default",
    "    --help  display this help and exit",
  ],
};

const argDefs = {
  format: { short: "c", type: "string" as const },
};

export const statCommand: Command = {
  name: "stat",

  async execute(args: string[], ctx: CommandContext): Promise<ExecResult> {
    if (hasHelpFlag(args)) {
      return showHelp(statHelp);
    }

    const parsed = parseArgs("stat", args, argDefs);
    if (!parsed.ok) return parsed.error;

    const format = parsed.result.flags.format ?? null;
    const files = parsed.result.positional;

    if (files.length === 0) {
      return {
        stdout: "",
        stderr: "stat: missing operand\n",
        exitCode: 1,
      };
    }

    let stdout = "";
    let stderr = "";
    let hasError = false;

    for (const file of files) {
      const fullPath = ctx.fs.resolvePath(ctx.cwd, file);

      try {
        const stat = await ctx.fs.stat(fullPath);

        if (format) {
          // Handle custom format
          let output = format;
          const modeOctal = stat.mode.toString(8);
          const modeStr = formatModeString(stat.mode, stat.isDirectory);
          output = output.replace(/%n/g, file); // file name
          output = output.replace(/%N/g, `'${file}'`); // quoted file name
          output = output.replace(/%s/g, String(stat.size)); // size
          output = output.replace(
            /%F/g,
            stat.isDirectory ? "directory" : "regular file",
          ); // file type
          output = output.replace(/%a/g, modeOctal); // access rights (octal)
          output = output.replace(/%A/g, modeStr); // access rights (human readable)
          output = output.replace(/%u/g, "1000"); // user ID
          output = output.replace(/%U/g, "user"); // user name
          output = output.replace(/%g/g, "1000"); // group ID
          output = output.replace(/%G/g, "group"); // group name
          stdout += `${output}\n`;
        } else {
          // Default format
          const modeOctal = stat.mode.toString(8).padStart(4, "0");
          const modeStr = formatModeString(stat.mode, stat.isDirectory);
          stdout += `  File: ${file}\n`;
          stdout += `  Size: ${stat.size}\t\tBlocks: ${Math.ceil(stat.size / 512)}\n`;
          stdout += `Access: (${modeOctal}/${modeStr})\n`;
          stdout += `Modify: ${stat.mtime.toISOString()}\n`;
        }
      } catch {
        stderr += `stat: cannot stat '${file}': No such file or directory\n`;
        hasError = true;
      }
    }

    return { stdout, stderr, exitCode: hasError ? 1 : 0 };
  },
};

function formatModeString(mode: number, isDirectory: boolean): string {
  const typeChar = isDirectory ? "d" : "-";
  const perms = [
    mode & 0o400 ? "r" : "-",
    mode & 0o200 ? "w" : "-",
    mode & 0o100 ? "x" : "-",
    mode & 0o040 ? "r" : "-",
    mode & 0o020 ? "w" : "-",
    mode & 0o010 ? "x" : "-",
    mode & 0o004 ? "r" : "-",
    mode & 0o002 ? "w" : "-",
    mode & 0o001 ? "x" : "-",
  ];
  return typeChar + perms.join("");
}
