import { utf8ByteLength } from "../../encoding.js";
import { rethrowFatalExecutionError } from "../../fatal-execution-error.js";
import { ExecutionLimitError } from "../../interpreter/errors.js";
import type { Command, CommandContext, ExecResult } from "../../types.js";
import { parseArgs } from "../../utils/args.js";
import { formatMode } from "../format-mode.js";
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
    let stdoutBytes = 0;
    const maxOutputBytes = Math.min(
      ctx.limits.maxOutputSize,
      ctx.limits.maxStringLength,
    );
    const appendStdout = (value: string): void => {
      const valueBytes = utf8ByteLength(value);
      if (valueBytes > maxOutputBytes - stdoutBytes) {
        throw new ExecutionLimitError(
          `stat: output size limit exceeded (${maxOutputBytes} bytes)`,
          "output_size",
        );
      }
      stdout += value;
      stdoutBytes += valueBytes;
    };

    for (const file of files) {
      const fullPath = ctx.fs.resolvePath(ctx.cwd, file);

      try {
        const stat = await ctx.fs.stat(fullPath);

        if (format) {
          // Handle custom format
          const modeOctal = stat.mode.toString(8);
          const modeStr = formatMode(stat.mode, stat.isDirectory);
          const replacements = new Map<string, string>([
            ["%n", file],
            ["%N", `'${file}'`],
            ["%s", String(stat.size)],
            ["%F", stat.isDirectory ? "directory" : "regular file"],
            ["%a", modeOctal],
            ["%A", modeStr],
            ["%u", "1000"],
            ["%U", "user"],
            ["%g", "1000"],
            ["%G", "group"],
          ]);
          const output = format.replace(/%[nNsFaAuUgG]/g, (directive) => {
            return replacements.get(directive) ?? directive;
          });
          appendStdout(`${output}\n`);
        } else {
          // Default format
          const modeOctal = stat.mode.toString(8).padStart(4, "0");
          const modeStr = formatMode(stat.mode, stat.isDirectory);
          appendStdout(
            `  File: ${file}\n  Size: ${stat.size}\t\tBlocks: ${Math.ceil(stat.size / 512)}\nAccess: (${modeOctal}/${modeStr})\nModify: ${stat.mtime.toISOString()}\n`,
          );
        }
      } catch (error) {
        rethrowFatalExecutionError(error);
        stderr += `stat: cannot stat '${file}': No such file or directory\n`;
        hasError = true;
      }
    }

    return { stdout, stderr, exitCode: hasError ? 1 : 0 };
  },
};

// formatMode imported from ../format-mode.js

import type { CommandFuzzInfo } from "../fuzz-flags-types.js";

export const flagsForFuzzing: CommandFuzzInfo = {
  name: "stat",
  flags: [
    { flag: "-c", type: "value", valueHint: "format" },
    { flag: "-L", type: "boolean" },
  ],
  needsArgs: true,
};
