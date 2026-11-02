import { encodeUtf8ToBytes, latin1FromBytes } from "../../encoding.js";
import { rethrowFatalExecutionError } from "../../fatal-execution-error.js";
import { ExecutionLimitError } from "../../interpreter/errors.js";
import type {
  ExecResult,
  RuntimeCommand,
  RuntimeCommandContext,
} from "../../types.js";
import { parseArgs } from "../../utils/args.js";
import { commandTimeZone } from "../date/date.js";
import { formatMode } from "../format-mode.js";
import { hasHelpFlag, showHelp } from "../help.js";
import { processEscapes } from "../printf/escapes.js";
import { formatStrftime } from "../printf/strftime.js";

const statHelp = {
  name: "stat",
  summary: "display file or file system status",
  usage: "stat [OPTION]... FILE...",
  options: [
    "-c, --format=FORMAT   use FORMAT and append a newline",
    "    --printf=FORMAT   use FORMAT with escapes and no added newline",
    "-L, --dereference     follow symbolic links",
    "    --help  display this help and exit",
  ],
};

const argDefs = {
  format: { short: "c", long: "format", type: "string" as const },
  dereference: { short: "L", long: "dereference", type: "boolean" as const },
};

export const statCommand: RuntimeCommand = {
  name: "stat",

  async execute(
    args: string[],
    ctx: RuntimeCommandContext,
  ): Promise<ExecResult> {
    if (hasHelpFlag(args)) {
      return showHelp(statHelp);
    }

    // Normalize both format controls through the shared parser; the last one wins.
    let printf = false;
    const normalized: string[] = [];
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === "--") {
        normalized.push(...args.slice(i));
        break;
      }
      if (arg === "--printf" || arg === "--format" || arg === "-c") {
        printf = arg === "--printf";
        normalized.push(arg === "--printf" ? "--format" : arg);
        if (i + 1 < args.length) normalized.push(args[++i]);
      } else if (
        arg.startsWith("-") &&
        !arg.startsWith("--") &&
        arg.includes("c")
      ) {
        printf = false;
        normalized.push(arg);
        if (arg.indexOf("c") === arg.length - 1 && i + 1 < args.length)
          normalized.push(args[++i]);
      } else if (arg.startsWith("--printf=")) {
        printf = true;
        normalized.push(`--format=${arg.slice(9)}`);
      } else {
        if (arg.startsWith("--format=") || arg.startsWith("-c")) printf = false;
        normalized.push(arg);
      }
    }
    const parsed = parseArgs("stat", normalized, argDefs);
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
    const maxOutputBytes = Math.min(
      ctx.limits.maxOutputSize,
      ctx.limits.maxStringLength,
    );
    const appendBytes = (value: string): void => {
      if (value.length > maxOutputBytes - stdout.length) {
        throw new ExecutionLimitError(
          `stat: output size limit exceeded (${maxOutputBytes} bytes)`,
          "output_size",
        );
      }
      stdout += value;
    };

    const appendStdout = (value: string): void =>
      appendBytes(latin1FromBytes(encodeUtf8ToBytes(value)));
    const encodedFormat =
      format === null
        ? null
        : printf
          ? processEscapes(format, maxOutputBytes, true)
          : latin1FromBytes(encodeUtf8ToBytes(format));
    const timezone = commandTimeZone(ctx);
    const metadata = ctx.virtualFileMetadata;
    let operations = 0;
    for (const file of files) {
      const fullPath = ctx.fs.resolvePath(ctx.cwd, file);

      try {
        const stat = parsed.result.flags.dereference
          ? await ctx.fs.stat(fullPath)
          : await ctx.fs.lstat(fullPath);
        const size = stat.isDirectory
          ? (metadata?.directorySize ?? stat.size)
          : stat.size;
        const mode = stat.mode & 0o7777;
        const modeStr = formatMode(mode, stat.isDirectory, stat.isSymbolicLink);

        if (encodedFormat !== null) {
          // Handle custom format
          const modeOctal = mode.toString(8);
          const timestamp = stat.mtime.getTime() / 1000;
          const replacements = new Map<string, string>([
            ["%n", file],
            ["%N", `'${file}'`],
            ["%s", String(size)],
            [
              "%F",
              stat.isSymbolicLink
                ? "symbolic link"
                : stat.isDirectory
                  ? "directory"
                  : stat.size === 0
                    ? "regular empty file"
                    : "regular file",
            ],
            ["%a", modeOctal],
            ["%A", modeStr],
            ["%u", String(metadata?.uid ?? 1000)],
            ["%U", metadata?.user ?? "user"],
            ["%g", String(metadata?.gid ?? 1000)],
            ["%G", metadata?.group ?? "group"],
            ["%Y", String(Math.floor(timestamp))],
            ["%h", String(metadata?.nlink ?? 1)],
            ["%i", String(stat.ino ?? 0)],
            ["%%", "%"],
          ]);
          for (let i = 0; i < encodedFormat.length; i++) {
            if (++operations > ctx.limits.maxLoopIterations)
              throw new ExecutionLimitError(
                "stat: format iteration limit exceeded",
                "iterations",
              );
            if (encodedFormat[i] === "%" && i + 1 < encodedFormat.length) {
              const directive = encodedFormat.slice(i, i + 2);
              if (directive === "%y" && !replacements.has(directive)) {
                replacements.set(
                  directive,
                  formatStrftime(
                    "%Y-%m-%d %H:%M:%S.%N %z",
                    timestamp,
                    timezone,
                    {
                      maxOperations: ctx.limits.maxLoopIterations,
                      maxOutputBytes: maxOutputBytes - stdout.length,
                    },
                  ),
                );
              }
              appendStdout(replacements.get(directive) ?? "?");
              i++;
            } else appendBytes(encodedFormat[i]);
          }
          if (!printf) appendBytes("\n");
        } else {
          // Default format
          const modeOctal = mode.toString(8).padStart(4, "0");
          appendStdout(
            `  File: ${file}\n  Size: ${size}\t\tBlocks: ${Math.ceil(size / (metadata?.allocationBlockSize ?? 512)) * ((metadata?.allocationBlockSize ?? 512) / 512)}\nAccess: (${modeOctal}/${modeStr})\nModify: ${stat.mtime.toISOString()}\n`,
          );
        }
      } catch (error) {
        rethrowFatalExecutionError(error);
        stderr += `stat: cannot stat '${file}': No such file or directory\n`;
        hasError = true;
      }
    }

    return { stdout, stdoutKind: "bytes", stderr, exitCode: hasError ? 1 : 0 };
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
