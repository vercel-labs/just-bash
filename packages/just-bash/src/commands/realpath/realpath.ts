import { sanitizeErrorMessage } from "../../fs/sanitize-error.js";
import {
  ExecutionAbortedError,
  ExecutionLimitError,
} from "../../interpreter/errors.js";
import type {
  ExecResult,
  RuntimeCommand,
  RuntimeCommandContext,
} from "../../types.js";
import { hasHelpFlag, showHelp, unknownOption } from "../help.js";

const realpathHelp = {
  name: "realpath",
  summary: "print the resolved physical path",
  usage: "realpath FILE...",
  options: ["    --help display this help and exit"],
};

function formatRealpathError(error: unknown): string {
  const message = sanitizeErrorMessage(
    error instanceof Error ? error.message : String(error),
  );
  if (/ENOENT|no such file/i.test(message)) return "No such file or directory";
  if (/ELOOP|too many levels/i.test(message)) {
    return "Too many levels of symbolic links";
  }
  if (/EACCES|EPERM|permission denied|operation not permitted/i.test(message)) {
    return "Permission denied";
  }
  return message || "Unknown error";
}

export const realpathCommand: RuntimeCommand = {
  name: "realpath",

  async execute(
    args: string[],
    ctx: RuntimeCommandContext,
  ): Promise<ExecResult> {
    if (hasHelpFlag(args)) {
      return showHelp(realpathHelp);
    }

    let argIdx = 0;
    while (argIdx < args.length && args[argIdx].startsWith("-")) {
      const arg = args[argIdx];
      if (arg === "--") {
        argIdx++;
        break;
      }
      return unknownOption("realpath", arg);
    }

    const files = args.slice(argIdx);
    if (files.length === 0) {
      return { stdout: "", stderr: "realpath: missing operand\n", exitCode: 1 };
    }

    let stdout = "";
    let stderr = "";
    let hasError = false;

    for (const file of files) {
      const filePath = ctx.fs.resolvePath(ctx.cwd, file);

      try {
        const resolved = await ctx.fs.realpath(filePath);
        stdout += `${resolved}\n`;
      } catch (error) {
        if (
          error instanceof ExecutionLimitError ||
          error instanceof ExecutionAbortedError
        ) {
          throw error;
        }

        hasError = true;
        stderr += `realpath: '${file}': ${formatRealpathError(error)}\n`;
      }
    }

    return { stdout, stderr, exitCode: hasError ? 1 : 0 };
  },
};

import type { CommandFuzzInfo } from "../fuzz-flags-types.js";

export const flagsForFuzzing: CommandFuzzInfo = {
  name: "realpath",
  flags: [],
  needsArgs: true,
};
