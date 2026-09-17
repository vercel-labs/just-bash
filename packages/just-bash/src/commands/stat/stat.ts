import { utf8ByteLength } from "../../encoding.js";
import { rethrowFatalExecutionError } from "../../fatal-execution-error.js";
import { ExecutionLimitError } from "../../interpreter/errors.js";
import type {
  ExecResult,
  RuntimeCommand,
  RuntimeCommandContext,
} from "../../types.js";
import { parseArgs } from "../../utils/args.js";
import { formatMode } from "../format-mode.js";
import { hasHelpFlag, showHelp } from "../help.js";
import { formatStrftime } from "../printf/strftime.js";

const statHelp = {
  name: "stat",
  summary: "display file or file system status",
  usage: "stat [OPTION]... FILE...",
  options: [
    "-c FORMAT   use the specified FORMAT instead of the default",
    "    --help  display this help and exit",
  ],
  notes: [
    "FORMAT directives: %a %A %f %F %g %G %n %N %s %u %U, the modification",
    "times %y and %Y, %w and %W for a birth time nothing records, and %%",
    "for a literal percent. A directive naming something this filesystem",
    "does not record, access and change times among them, prints '?', the",
    "same as an unknown directive.",
  ],
};

const argDefs = {
  format: { short: "c", type: "string" as const },
};

const NANOSECONDS_PER_MILLISECOND = 1_000_000;

/**
 * The timezone timestamps are shown in, on the same contract as `date`: $TZ
 * when Intl accepts it, UTC otherwise, so the host zone never leaks unless the
 * caller opts in.
 */
function displayTimezone(tz: string | undefined): string {
  if (!tz) return "UTC";
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

/**
 * A timestamp in GNU's `%y` form: `2024-01-15 09:17:14.764000000 +0000`.
 * The filesystem stores milliseconds, so the last six digits are always zero.
 */
function formatTimestamp(
  when: Date,
  tz: string,
  limits: { maxOperations: number; maxOutputBytes: number },
): string {
  const seconds = Math.floor(when.getTime() / 1000);
  const nanoseconds = String(
    when.getMilliseconds() * NANOSECONDS_PER_MILLISECOND,
  ).padStart(9, "0");
  const wall = formatStrftime("%Y-%m-%d %H:%M:%S", seconds, tz, limits);
  const offset = formatStrftime("%z", seconds, tz, limits);
  return `${wall}.${nanoseconds} ${offset}`;
}

/**
 * Expand a `-c` FORMAT: `%` followed by optional `-`/`0` flags, an optional
 * width, and a directive. A directive with no value prints `?` rather than
 * reaching the caller as itself, which reads as output rather than as a gap.
 *
 * `resolve` is asked only for the directives a FORMAT actually names, so a
 * value that costs something to build is not built for a format that does not
 * use it.
 */
function expandFormat(
  format: string,
  resolve: (directive: string) => string | undefined,
  maxOutputBytes: number,
): string {
  let out = "";
  let index = 0;
  while (index < format.length) {
    if (format[index] !== "%") {
      out += format[index];
      index++;
    } else {
      let cursor = index + 1;
      let leftAlign = false;
      let padding = " ";
      while (format[cursor] === "-" || format[cursor] === "0") {
        if (format[cursor] === "-") leftAlign = true;
        else padding = "0";
        cursor++;
      }
      let width = "";
      while (format[cursor] >= "0" && format[cursor] <= "9") {
        width += format[cursor];
        cursor++;
      }
      const directive = format[cursor];
      if (directive === undefined) {
        // A `%` that runs off the end of FORMAT is printed as itself.
        out += format.slice(index);
        break;
      }
      const value = directive === "%" ? "%" : (resolve(directive) ?? "?");
      const target = Math.min(
        width === "" ? 0 : Number.parseInt(width, 10),
        maxOutputBytes,
      );
      // @banned-pattern-ignore: target is bounded by maxOutputBytes directly above
      out += leftAlign ? value.padEnd(target) : value.padStart(target, padding);
      index = cursor + 1;
    }
    if (out.length > maxOutputBytes) {
      throw new ExecutionLimitError(
        `stat: output size limit exceeded (${maxOutputBytes} bytes)`,
        "output_size",
      );
    }
  }
  return out;
}

export const statCommand: RuntimeCommand = {
  name: "stat",

  async execute(
    args: string[],
    ctx: RuntimeCommandContext,
  ): Promise<ExecResult> {
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
    const timezone = displayTimezone(ctx.env.get("TZ"));
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
          const values = new Map<string, string>([
            ["n", file],
            ["N", `'${file}'`],
            ["s", String(stat.size)],
            ["F", stat.isDirectory ? "directory" : "regular file"],
            ["a", (stat.mode & 0o7777).toString(8)],
            ["A", formatMode(stat.mode, stat.isDirectory)],
            // The type bits are composed rather than read off `mode`, which
            // carries them on some filesystems and not others, the same
            // reason `formatMode` is passed `isDirectory` separately.
            [
              "f",
              (
                (stat.isDirectory ? 0o040000 : 0o100000) |
                (stat.mode & 0o7777)
              ).toString(16),
            ],
            ["u", "1000"],
            ["U", "user"],
            ["g", "1000"],
            ["G", "group"],
            ["Y", String(Math.floor(stat.mtime.getTime() / 1000))],
            // Birth time is not recorded, which GNU renders as `-` and `0`.
            // Access and change times are not either, and they are left to
            // the `?` every unanswerable directive gets: reporting the
            // modification time for them would be a plausible wrong answer
            // on a filesystem where the three genuinely differ.
            ["w", "-"],
            ["W", "0"],
          ]);
          // Formatted on demand, so a FORMAT that names no wall clock does
          // not pay for one, and cannot fail a limit its own output fits.
          let wallClock: string | undefined;
          const resolve = (directive: string) => {
            if (directive !== "y") return values.get(directive);
            if (wallClock === undefined) {
              wallClock = formatTimestamp(stat.mtime, timezone, {
                maxOperations: ctx.limits.maxLoopIterations,
                maxOutputBytes,
              });
            }
            return wallClock;
          };
          appendStdout(`${expandFormat(format, resolve, maxOutputBytes)}\n`);
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
