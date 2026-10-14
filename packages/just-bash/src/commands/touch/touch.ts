import { rethrowFatalExecutionError } from "../../fatal-execution-error.js";
import { getErrorMessage } from "../../interpreter/helpers/errors.js";
import type {
  ExecResult,
  RuntimeCommand,
  RuntimeCommandContext,
} from "../../types.js";
import { unknownOption } from "../help.js";
import { resolveTimezoneAt } from "../posix-timezone.js";
import {
  currentYearInTimezone,
  hasExplicitZone,
  parseBareISOInTimezone,
  parseZonelessInTimezone,
} from "../timezone.js";

/**
 * Parse a date string in various formats supported by touch -d
 * Supports:
 * - YYYY/MM/DD or YYYY-MM-DD
 * - YYYY/MM/DD HH:MM:SS or YYYY-MM-DD HH:MM:SS
 * - ISO 8601 format
 *
 * A spelling that names no zone is read in `tz` when the shell sets one,
 * through the same `parseZonelessInTimezone` `date -d` uses, so a stamp
 * written here reads back the same way there. Without `$TZ` it goes to
 * `new Date`, as it does in `date -d`.
 */
function parseDateString(dateStr: string, tz?: string): Date | null {
  // Replace / with - for consistency, after trimming, since a leading space
  // would otherwise keep the spelling out of the zone-aware grammar.
  const normalized = dateStr.trim().replace(/\//g, "-");

  if (tz && !hasExplicitZone(normalized)) {
    const zoned =
      parseBareISOInTimezone(normalized.replace(/\s+/, "T"), tz) ??
      parseZonelessInTimezone(normalized, tz);
    if (zoned) return zoned;
  }

  // Anything else carries its own offset, the shell has no $TZ, or it is a
  // spelling neither reading above understands.
  const date = new Date(normalized);
  if (!Number.isNaN(date.getTime())) {
    return date;
  }

  return null;
}

/**
 * Parse the stamp `touch -t` takes: `[[CC]YY]MMDDhhmm[.ss]`.
 *
 * Two-digit years pivot at 69, the boundary POSIX fixes for this format: 69
 * through 99 are 1969-1999, 00 through 68 are 2000-2068. Without a year at
 * all the stamp lands in the year `tz` is currently in, or the UTC year when
 * the shell has no `$TZ`: the host's calendar would otherwise decide it, and
 * the two disagree either side of a New Year boundary.
 *
 * The stamp names no zone, so it is read in `tz`, a zone Intl accepts or a
 * POSIX TZ string, or in UTC when the shell has no `$TZ`.
 */
function parseTimestampString(stamp: string, tz?: string): Date | null {
  const match = /^(\d{8}|\d{10}|\d{12})(?:\.(\d{2}))?$/.exec(stamp);
  if (!match) return null;

  const [, digits, secondsPart] = match;
  const rest = digits.slice(digits.length - 8);
  const yearDigits = digits.slice(0, digits.length - 8);

  let year: number;
  if (yearDigits.length === 4) {
    year = Number.parseInt(yearDigits, 10);
  } else if (yearDigits.length === 2) {
    const twoDigit = Number.parseInt(yearDigits, 10);
    year = twoDigit >= 69 ? 1900 + twoDigit : 2000 + twoDigit;
  } else {
    year = currentYearInTimezone(tz);
  }

  const month = Number.parseInt(rest.slice(0, 2), 10);
  const day = Number.parseInt(rest.slice(2, 4), 10);
  const hour = Number.parseInt(rest.slice(4, 6), 10);
  const minute = Number.parseInt(rest.slice(6, 8), 10);
  // POSIX allows a leap second, `.60`, which lands on the next minute.
  const leapSecond = secondsPart === "60";
  const second =
    secondsPart && !leapSecond ? Number.parseInt(secondsPart, 10) : 0;

  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;

  const pad = (n: number) => String(n).padStart(2, "0");
  const wall = `${String(year).padStart(4, "0")}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}`;

  // A wall time the zone skips, inside a spring-forward gap, is rejected.
  const date = tz
    ? parseBareISOInTimezone(wall, tz, { strict: true })
    : new Date(`${wall}Z`);
  if (date === null || Number.isNaN(date.getTime())) return null;

  // Reject a day the month does not have, which Date would roll forward.
  const check = new Date(`${wall}Z`);
  if (
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day ||
    check.getUTCFullYear() !== year
  ) {
    return null;
  }
  return leapSecond ? new Date(date.getTime() + 60_000) : date;
}

/**
 * What to print after "failed to get attributes of 'ref'". Absence gets the
 * wording `touch` uses for it; anything else keeps the reason it came with,
 * since reporting a reference that exists as missing sends the caller looking
 * for a file that is right there.
 */
function referenceFailureReason(error: unknown): string {
  const message = getErrorMessage(error);
  return message.includes("ENOENT") || message.includes("no such file")
    ? "No such file or directory"
    : message;
}

/** Where the timestamp to write came from; the last flag given wins. */
type TimeSource =
  | { kind: "date"; value: string }
  | { kind: "stamp"; value: string }
  | { kind: "reference"; value: string };

export const touchCommand: RuntimeCommand = {
  name: "touch",

  async execute(
    args: string[],
    ctx: RuntimeCommandContext,
  ): Promise<ExecResult> {
    const files: string[] = [];
    let timeSource: TimeSource | null = null;
    let noCreate = false;
    let accessTime = false;
    let modificationTime = false;

    // Parse arguments
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];

      if (arg === "--") {
        // Rest are files
        files.push(...args.slice(i + 1));
        break;
      } else if (arg === "-d" || arg === "--date") {
        // -d DATE or --date=DATE
        if (i + 1 >= args.length) {
          return {
            stdout: "",
            stderr: "touch: option requires an argument -- 'd'\n",
            exitCode: 1,
          };
        }
        timeSource = { kind: "date", value: args[++i] };
      } else if (arg.startsWith("--date=")) {
        timeSource = { kind: "date", value: arg.slice("--date=".length) };
      } else if (arg === "-c" || arg === "--no-create") {
        noCreate = true;
      } else if (arg === "-t" || arg === "-r") {
        if (i + 1 >= args.length) {
          return {
            stdout: "",
            stderr: `touch: option requires an argument -- '${arg.slice(1)}'\n`,
            exitCode: 1,
          };
        }
        timeSource = {
          kind: arg === "-t" ? "stamp" : "reference",
          value: args[++i],
        };
      } else if (arg === "-a") {
        accessTime = true;
      } else if (arg === "-m") {
        modificationTime = true;
      } else if (arg.startsWith("--")) {
        return unknownOption("touch", arg);
      } else if (arg.startsWith("-") && arg.length > 1) {
        // Check for combined short options like -cm
        let skipNext = false;
        for (const char of arg.slice(1)) {
          if (char === "c") {
            noCreate = true;
          } else if (char === "a") {
            accessTime = true;
          } else if (char === "m") {
            modificationTime = true;
          } else if (char === "d" || char === "t" || char === "r") {
            // Each of these consumes the next argument.
            if (i + 1 >= args.length) {
              return {
                stdout: "",
                stderr: `touch: option requires an argument -- '${char}'\n`,
                exitCode: 1,
              };
            }
            timeSource = {
              kind:
                char === "d" ? "date" : char === "t" ? "stamp" : "reference",
              value: args[++i],
            };
            skipNext = true;
            break;
          } else {
            return unknownOption("touch", `-${char}`);
          }
        }
        if (skipNext) continue;
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

    // Resolve whichever of -d, -t and -r was given last.
    // An unset or unresolvable $TZ leaves tz undefined, as it does in date:
    // -t then reads in UTC and -d the way date -d does. A POSIX TZ string
    // such as EST5 counts as resolvable.
    let tz = ctx.env.get("TZ");
    if (tz && resolveTimezoneAt(tz, Date.now()) === null) tz = undefined;

    let targetTime: Date | null = null;
    if (timeSource !== null) {
      if (timeSource.kind === "reference") {
        try {
          const reference = ctx.fs.resolvePath(ctx.cwd, timeSource.value);
          // Copy the instant out rather than keeping the Date the context
          // handed back: that object stops answering once the command ends,
          // and it is about to be written into the filesystem.
          targetTime = new Date((await ctx.fs.stat(reference)).mtime.getTime());
        } catch (error) {
          // Abort, limit and security-violation errors have to keep
          // propagating; only a genuinely missing reference is reported here.
          rethrowFatalExecutionError(error);
          return {
            stdout: "",
            stderr: `touch: failed to get attributes of '${timeSource.value}': ${referenceFailureReason(error)}\n`,
            exitCode: 1,
          };
        }
      } else {
        targetTime =
          timeSource.kind === "stamp"
            ? parseTimestampString(timeSource.value, tz)
            : parseDateString(timeSource.value, tz);
        if (targetTime === null) {
          return {
            stdout: "",
            stderr: `touch: invalid date format '${timeSource.value}'\n`,
            exitCode: 1,
          };
        }
      }
    }

    let stderr = "";
    let exitCode = 0;

    for (const file of files) {
      try {
        const fullPath = ctx.fs.resolvePath(ctx.cwd, file);
        const exists = await ctx.fs.exists(fullPath);

        if (!exists) {
          if (noCreate) {
            // -c: don't create, just skip
            continue;
          }
          await ctx.fs.writeFile(fullPath, "");
        }

        // `-a` without `-m` sets only the access time, so the modification
        // time is written back as it was.
        const time = targetTime ?? new Date();
        const mtime =
          accessTime && !modificationTime
            ? new Date((await ctx.fs.stat(fullPath)).mtime.getTime())
            : time;
        await ctx.fs.utimes(fullPath, time, mtime);
      } catch (error) {
        // A limit, an abort or a security violation is not this file failing
        // to be touched; it has to keep going up.
        rethrowFatalExecutionError(error);
        stderr += `touch: cannot touch '${file}': ${getErrorMessage(error)}\n`;
        exitCode = 1;
      }
    }

    return { stdout: "", stderr, exitCode };
  },
};

import type { CommandFuzzInfo } from "../fuzz-flags-types.js";

export const flagsForFuzzing: CommandFuzzInfo = {
  name: "touch",
  flags: [
    { flag: "-c", type: "boolean" },
    { flag: "-a", type: "boolean" },
    { flag: "-m", type: "boolean" },
    { flag: "-d", type: "value", valueHint: "string" },
    { flag: "-t", type: "value", valueHint: "string" },
    { flag: "-r", type: "value", valueHint: "path" },
  ],
  needsArgs: true,
};
