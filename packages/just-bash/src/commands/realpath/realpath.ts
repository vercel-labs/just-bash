import { utf8ByteLength } from "../../encoding.js";
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
import { showHelp, unknownOption } from "../help.js";

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
  if (/ENOTDIR|not a directory/i.test(message)) return "Not a directory";
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
    let argIdx = 0;
    while (
      argIdx < args.length &&
      args[argIdx] !== "-" &&
      args[argIdx].startsWith("-")
    ) {
      const arg = args[argIdx];
      if (arg === "--") {
        argIdx++;
        break;
      }
      if (arg === "--help") {
        return showHelp(realpathHelp);
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
    const maxOutputBytes = Math.min(
      ctx.limits.maxOutputSize,
      ctx.limits.maxStringLength,
    );
    let outputBytes = 0;

    const appendOutput = (options: {
      stream: "stdout" | "stderr";
      value: string;
    }): void => {
      const bytes = utf8ByteLength(options.value);
      if (bytes > maxOutputBytes - outputBytes) {
        throw new ExecutionLimitError(
          `realpath: output size limit exceeded (${maxOutputBytes} bytes)`,
          "output_size",
        );
      }
      outputBytes += bytes;
      if (options.stream === "stdout") stdout += options.value;
      else stderr += options.value;
    };

    for (const file of files) {
      if (file === "") {
        hasError = true;
        appendOutput({
          stream: "stderr",
          value: "realpath: '': No such file or directory\n",
        });
        continue;
      }

      try {
        const resolved = await ctx.fs.realpathFromCwd({
          cwd: ctx.cwd,
          path: file,
          signal: ctx.signal,
        });
        appendOutput({ stream: "stdout", value: `${resolved}\n` });
      } catch (error) {
        if (
          error instanceof ExecutionLimitError ||
          error instanceof ExecutionAbortedError
        ) {
          throw error;
        }

        hasError = true;
        appendOutput({
          stream: "stderr",
          value: `realpath: '${file}': ${formatRealpathError(error)}\n`,
        });
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
