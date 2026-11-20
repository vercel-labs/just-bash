import { BoundedStringBuilder } from "../../bounded-builder.js";
import { rethrowFatalExecutionError } from "../../fatal-execution-error.js";
import { FileTraversalBudget, traverseFileTree } from "../../fs/traversal.js";
import type {
  ExecResult,
  RuntimeCommand,
  RuntimeCommandContext,
} from "../../types.js";
import { parseFileMode } from "../file-mode.js";
import { hasHelpFlag, showHelp, unknownOption } from "../help.js";

const chmodHelp = {
  name: "chmod",
  summary: "change file mode bits",
  usage: "chmod [OPTIONS] MODE FILE...",
  options: [
    "-R      change files recursively",
    "-v      output a diagnostic for every file processed",
    "    --help display this help and exit",
  ],
};

export const chmodCommand: RuntimeCommand = {
  name: "chmod",

  async execute(
    args: string[],
    ctx: RuntimeCommandContext,
  ): Promise<ExecResult> {
    if (hasHelpFlag(args)) {
      return showHelp(chmodHelp);
    }

    if (args.length < 2) {
      return { stdout: "", stderr: "chmod: missing operand\n", exitCode: 1 };
    }

    let recursive = false;
    let verbose = false;
    let argIdx = 0;

    // Parse options
    while (argIdx < args.length && args[argIdx].startsWith("-")) {
      const arg = args[argIdx];
      if (arg === "-R" || arg === "--recursive") {
        recursive = true;
        argIdx++;
      } else if (arg === "-v" || arg === "--verbose") {
        verbose = true;
        argIdx++;
      } else if (arg === "--") {
        argIdx++;
        break;
      } else {
        // Mode might start with - for removing permissions, check if it looks like a mode
        if (/^[+-]?[rwxugo]+/.test(arg) || /^\d+$/.test(arg)) {
          break;
        }
        // Check for combined flags like -Rv
        if (/^-[Rv]+$/.test(arg)) {
          if (arg.includes("R")) recursive = true;
          if (arg.includes("v")) verbose = true;
          argIdx++;
          continue;
        }
        return unknownOption("chmod", arg);
      }
    }

    if (args.length - argIdx < 2) {
      return { stdout: "", stderr: "chmod: missing operand\n", exitCode: 1 };
    }

    const modeArg = args[argIdx];
    const files = args.slice(argIdx + 1);

    // Check if mode is numeric or symbolic
    const isNumericMode = /^[0-7]+$/.test(modeArg);

    let numericMode: number | undefined;
    try {
      const parsedMode = parseFileMode(modeArg);
      if (isNumericMode) numericMode = parsedMode;
    } catch {
      return {
        stdout: "",
        stderr: `chmod: invalid mode: '${modeArg}'\n`,
        exitCode: 1,
      };
    }

    const output = new BoundedStringBuilder(
      Math.min(ctx.limits.maxOutputSize, ctx.limits.maxStringLength),
      "chmod",
    );
    let stderr = "";
    let anyError = false;

    for (const file of files) {
      const filePath = ctx.fs.resolvePath(ctx.cwd, file);
      try {
        // For symbolic mode, we need to read the current mode first
        let modeValue: number;
        if (isNumericMode && numericMode !== undefined) {
          modeValue = numericMode;
        } else {
          const stat = await ctx.fs.stat(filePath);
          modeValue = parseFileMode(modeArg, stat.mode, stat.isDirectory);
        }

        await ctx.fs.chmod(filePath, modeValue);
        if (verbose) {
          output.append(
            `mode of '${file}' changed to ${modeValue.toString(8).padStart(4, "0")}\n`,
          );
        }

        if (recursive) {
          // Check if directory
          const stat = await ctx.fs.stat(filePath);
          if (stat.isDirectory) {
            await chmodRecursive(
              ctx,
              filePath,
              isNumericMode ? numericMode : undefined,
              isNumericMode ? undefined : modeArg,
              verbose,
              output,
            );
          }
        }
      } catch (error) {
        rethrowFatalExecutionError(error);
        stderr += `chmod: cannot access '${file}': No such file or directory\n`;
        anyError = true;
      }
    }

    return { stdout: output.build(), stderr, exitCode: anyError ? 1 : 0 };
  },
};

async function chmodRecursive(
  ctx: RuntimeCommandContext,
  dir: string,
  numericMode: number | undefined,
  symbolicMode: string | undefined,
  verbose: boolean,
  output: BoundedStringBuilder,
): Promise<void> {
  const budget = new FileTraversalBudget({
    limits: ctx.limits,
    signal: ctx.signal,
    executionScope: ctx.executionScope,
    site: "chmod",
  });
  await traverseFileTree(
    {
      fs: ctx.fs,
      root: dir,
      symlinks: "never",
      budget,
      limits: ctx.limits,
      signal: ctx.signal,
      executionScope: ctx.executionScope,
      site: "chmod",
    },
    async (entry) => {
      if (entry.depth === 0 || entry.phase !== "enter") return;
      const modeValue =
        numericMode !== undefined
          ? numericMode
          : symbolicMode !== undefined
            ? parseFileMode(
                symbolicMode,
                entry.stat.mode,
                entry.stat.isDirectory,
              )
            : 0o644;
      await ctx.fs.chmod(entry.path, modeValue);
      if (verbose) {
        output.append(
          `mode of '${entry.path}' changed to ${modeValue.toString(8).padStart(4, "0")}\n`,
        );
      }
    },
  );
}

import type { CommandFuzzInfo } from "../fuzz-flags-types.js";

export const flagsForFuzzing: CommandFuzzInfo = {
  name: "chmod",
  flags: [
    { flag: "-R", type: "boolean" },
    { flag: "-v", type: "boolean" },
  ],
  needsArgs: true,
  minArgs: 2,
};
