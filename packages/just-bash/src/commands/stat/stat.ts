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
import { resolveTimezoneAt } from "../posix-timezone.js";
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
 * A timestamp in GNU's `%y` form: `2024-01-15 09:17:14.764000000 +0000`.
 * The filesystem stores milliseconds, so the last six digits are always zero.
 *
 * `$TZ` is read as a zone Intl accepts, or as a POSIX TZ string resolved to
 * the offset it puts in effect at `when`, and as UTC otherwise, as glibc does
 * for a value it cannot parse. No `$TZ` is UTC, as in `date`, so the host
 * zone never leaks unless the caller opts in.
 */
function formatTimestamp(when: Date, tz: string | undefined): string {
  // The two formats below have a fixed, short output, so they get their own
  // small limit: charging them against the output limit would fail a FORMAT
  // like `%.2y` whose truncated output fits.
  const limits = { maxOperations: 64, maxOutputBytes: 64 };
  const resolved = (tz && resolveTimezoneAt(tz, when.getTime())) || {
    zone: "UTC",
  };
  const nanoseconds = String(
    when.getMilliseconds() * NANOSECONDS_PER_MILLISECOND,
  ).padStart(9, "0");
  const seconds = Math.floor(when.getTime() / 1000);
  if ("zone" in resolved) {
    const wall = formatStrftime(
      "%Y-%m-%d %H:%M:%S",
      seconds,
      resolved.zone,
      limits,
    );
    const offset = formatStrftime("%z", seconds, resolved.zone, limits);
    return `${wall}.${nanoseconds} ${offset}`;
  }
  // A POSIX offset is applied by hand: the wall clock is the UTC one shifted
  // by it, and `%z` shows it in whole minutes, truncated as glibc does.
  const { offsetSeconds } = resolved;
  const wall = formatStrftime(
    "%Y-%m-%d %H:%M:%S",
    seconds + offsetSeconds,
    "UTC",
    limits,
  );
  const minutes = Math.trunc(Math.abs(offsetSeconds) / 60);
  const offset = `${offsetSeconds < 0 ? "-" : "+"}${String(Math.floor(minutes / 60)).padStart(2, "0")}${String(minutes % 60).padStart(2, "0")}`;
  return `${wall}.${nanoseconds} ${offset}`;
}

/**
 * What a directive resolves to, typed by the printf conversion GNU stat
 * formats it with: `%s` for text, `%u`, `%o` and `%x` for numbers, and its
 * own `%f`-like rendering for seconds since the epoch.
 */
type StatValue =
  | { kind: "string"; text: string }
  | { kind: "uint" | "octal" | "hex"; value: number }
  | { kind: "epoch"; ms: number };

/** `%[flags][width][.precision]`, the part of a directive before its letter. */
interface DirectiveSpec {
  flags: string;
  width: number | null;
  /** Null without a `.`, the empty string for a `.` with no digits. */
  precision: string | null;
}

/** GNU stat's printf flags, and the subset each conversion keeps. */
const PRINTF_FLAGS = "'-+ #0I";
const STRING_FLAGS = "-";
const UINT_FLAGS = "'-0";
const BASE_FLAGS = "-#0";
const INT_FLAGS = "'-+ 0";

class InvalidDirectiveError extends Error {
  constructor(
    message: string,
    /** What FORMAT printed before the directive GNU rejects. */
    readonly output: string,
  ) {
    super(message);
  }
}

function keepFlags(flags: string, allowed: string): string {
  return [...flags].filter((flag) => allowed.includes(flag)).join("");
}

/**
 * Pad `text` to `width` with `fill`, on the right when `left` is set. Throws
 * the output limit rather than allocating a width the output could not hold.
 */
function pad(
  text: string,
  width: number,
  fill: string,
  left: boolean,
  maxOutputBytes: number,
): string {
  if (text.length >= width) return text;
  if (width > maxOutputBytes) {
    throw new ExecutionLimitError(
      `stat: output size limit exceeded (${maxOutputBytes} bytes)`,
      "output_size",
    );
  }
  // @banned-pattern-ignore: width is bounded by maxOutputBytes directly above
  const padding = fill.repeat(width - text.length);
  return left ? text + padding : padding + text;
}

/**
 * The longest prefix of `text` that fits in `bytes` UTF-8 bytes. C printf
 * would cut a multibyte character in half; a string cannot hold half of one,
 * so the whole character is dropped instead.
 */
function truncateToBytes(text: string, bytes: number): string {
  let used = 0;
  let end = 0;
  for (const char of text) {
    used += utf8ByteLength(char);
    if (used > bytes) break;
    end += char.length;
  }
  return text.slice(0, end);
}

/** C printf's integer conversion: precision as minimum digits, then width. */
function formatInteger(
  digits: string,
  sign: string,
  prefix: string,
  flags: string,
  width: number | null,
  precision: number | null,
  maxOutputBytes: number,
): string {
  let body = digits;
  if (precision !== null) {
    body =
      precision === 0 && digits === "0"
        ? ""
        : pad(digits, precision, "0", false, maxOutputBytes);
  }
  if (flags.includes("#") && prefix === "0" && !body.startsWith("0")) {
    body = `0${body}`;
  }
  const lead = sign + (prefix === "0" ? "" : prefix);
  if (width === null) return lead + body;
  if (flags.includes("-")) {
    return pad(lead + body, width, " ", true, maxOutputBytes);
  }
  if (flags.includes("0") && precision === null) {
    return (
      lead +
      pad(body, Math.max(width - lead.length, 0), "0", false, maxOutputBytes)
    );
  }
  return pad(lead + body, width, " ", false, maxOutputBytes);
}

function precisionDigits(precision: string | null): number | null {
  return precision === null ? null : Number(precision || "0");
}

/** GNU's `out_int`: a signed decimal, with `+` and space flags honored. */
function formatSigned(
  value: number,
  flags: string,
  width: number | null,
  maxOutputBytes: number,
  negative = value < 0,
): string {
  const kept = keepFlags(flags, INT_FLAGS);
  let sign = "";
  if (negative) sign = "-";
  else if (kept.includes("+")) sign = "+";
  else if (kept.includes(" ")) sign = " ";
  return formatInteger(
    String(Math.abs(value)),
    sign,
    "",
    kept,
    width,
    null,
    maxOutputBytes,
  );
}

/**
 * GNU's `out_epoch_sec`: seconds since the epoch, with a precision printing
 * that many fractional digits (nine for a bare `.`) and a width covering the
 * whole number, fraction included.
 */
function formatEpoch(
  ms: number,
  spec: DirectiveSpec,
  maxOutputBytes: number,
): string {
  let seconds = Math.floor(ms / 1000);
  const nanoseconds = (ms - seconds * 1000) * NANOSECONDS_PER_MILLISECOND;
  if (spec.precision === null) {
    return formatSigned(seconds, spec.flags, spec.width, maxOutputBytes);
  }
  const precision = Math.min(
    spec.precision === "" ? 9 : Number(spec.precision),
    maxOutputBytes + 1,
  );
  let intFlags = spec.flags;
  let intWidth = spec.width;
  let width = 0;
  if (precision > 0 && spec.width !== null) {
    width = spec.width;
    if (width > 1) {
      intWidth = null;
      const widthBeforePoint = width - 1;
      const integerWidth = widthBeforePoint - precision;
      if (widthBeforePoint > 1 && integerWidth > 1) {
        // A `-` flag pads the fraction on the right instead.
        const fractionLeft = spec.flags.includes("-");
        intFlags = spec.flags.replaceAll("-", "");
        intWidth = fractionLeft ? null : integerWidth;
      }
    }
  }
  const shown = Math.min(precision, 9);
  const divisor = 10 ** (9 - shown);
  let fraction = Math.floor(nanoseconds / divisor);
  let minusZero = false;
  if (seconds < 0 && nanoseconds !== 0) {
    // Print a negative time as a negative number, not floor plus fraction.
    fraction = 10 ** shown - fraction - (nanoseconds % divisor !== 0 ? 1 : 0);
    if (fraction !== 0) seconds += 1;
    minusZero = seconds === 0;
  }
  const integer = formatSigned(
    seconds,
    intFlags,
    intWidth,
    maxOutputBytes,
    minusZero || seconds < 0,
  );
  if (precision === 0) return integer;
  const trailingZeros = pad("", precision - shown, "0", false, maxOutputBytes);
  const trailingWidth =
    integer.length < width && 1 < width - integer.length
      ? width - integer.length - 1 - shown
      : 0;
  // @banned-pattern-ignore: shown is at most 9
  const digits = String(fraction).padStart(shown, "0");
  return `${integer}.${digits}${pad(
    trailingZeros,
    Math.abs(trailingWidth),
    " ",
    true,
    maxOutputBytes,
  )}`;
}

/** Render `value` the way GNU stat's printf call for its kind would. */
function formatValue(
  value: StatValue,
  spec: DirectiveSpec,
  maxOutputBytes: number,
): string {
  switch (value.kind) {
    case "string": {
      // C printf counts a string's precision and width in bytes.
      const precision = precisionDigits(spec.precision);
      const text =
        precision === null
          ? value.text
          : truncateToBytes(value.text, precision);
      if (spec.width === null) return text;
      const left = keepFlags(spec.flags, STRING_FLAGS).includes("-");
      const multibyteExtra = utf8ByteLength(text) - text.length;
      return pad(text, spec.width - multibyteExtra, " ", left, maxOutputBytes);
    }
    case "uint":
      return formatInteger(
        String(value.value),
        "",
        "",
        keepFlags(spec.flags, UINT_FLAGS),
        spec.width,
        precisionDigits(spec.precision),
        maxOutputBytes,
      );
    case "octal":
    case "hex": {
      const octal = value.kind === "octal";
      const flags = keepFlags(spec.flags, BASE_FLAGS);
      let prefix = "";
      if (octal) prefix = "0";
      else if (flags.includes("#") && value.value !== 0) prefix = "0x";
      return formatInteger(
        value.value.toString(octal ? 8 : 16),
        "",
        prefix,
        flags,
        spec.width,
        precisionDigits(spec.precision),
        maxOutputBytes,
      );
    }
    case "epoch":
      return formatEpoch(value.ms, spec, maxOutputBytes);
  }
}

/**
 * Expand a `-c` FORMAT: `%`, then any of GNU's printf flags (`' - + space #
 * 0 I`), an optional width, an optional `.precision`, and a directive. Each
 * conversion keeps only the flags GNU passes to its printf call. A directive
 * with no value prints a bare `?`, as GNU prints an unknown one, rather than
 * reaching the caller as itself, which reads as output rather than as a gap.
 *
 * `resolve` is asked only for the directives a FORMAT actually names, so a
 * value that costs something to build is not built for a format that does not
 * use it.
 *
 * Throws InvalidDirectiveError, carrying the output so far, for a `%` with a
 * flag, width or precision that is followed by `%` or by nothing, as GNU
 * rejects it.
 */
function expandFormat(
  format: string,
  resolve: (directive: string) => StatValue | undefined,
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
      let flags = "";
      while (cursor < format.length && PRINTF_FLAGS.includes(format[cursor])) {
        flags += format[cursor];
        cursor++;
      }
      let width = "";
      while (format[cursor] >= "0" && format[cursor] <= "9") {
        width += format[cursor];
        cursor++;
      }
      let precision: string | null = null;
      if (format[cursor] === ".") {
        precision = "";
        cursor++;
        while (format[cursor] >= "0" && format[cursor] <= "9") {
          precision += format[cursor];
          cursor++;
        }
      }
      const directive = format[cursor];
      if (directive === undefined || directive === "%") {
        if (cursor > index + 1) {
          throw new InvalidDirectiveError(
            `stat: '${format.slice(index, cursor + 1)}': invalid directive\n`,
            out,
          );
        }
        out += "%";
        index = cursor + 1;
      } else {
        const value = resolve(directive);
        const spec: DirectiveSpec = {
          flags,
          // A width beyond the output limit is clamped just past it, so the
          // limit is reported instead of the width being parsed exactly.
          width:
            width === ""
              ? null
              : Math.min(Number.parseInt(width, 10), maxOutputBytes + 1),
          precision:
            precision === null || precision === ""
              ? precision
              : String(
                  Math.min(Number.parseInt(precision, 10), maxOutputBytes + 1),
                ),
        };
        out +=
          value === undefined ? "?" : formatValue(value, spec, maxOutputBytes);
        index = cursor + 1;
      }
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
    const timezone = ctx.env.get("TZ");
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
          const text = (value: string): StatValue => ({
            kind: "string",
            text: value,
          });
          const mtime = stat.mtime.getTime();
          const values = new Map<string, StatValue>([
            ["n", text(file)],
            // Quoted for a shell, with an embedded `'` closed, escaped and
            // reopened, so the result is safe to paste back as one word.
            ["N", text(`'${file.replaceAll("'", "'\\''")}'`)],
            ["s", { kind: "uint", value: stat.size }],
            ["F", text(stat.isDirectory ? "directory" : "regular file")],
            ["a", { kind: "octal", value: stat.mode & 0o7777 }],
            ["A", text(formatMode(stat.mode, stat.isDirectory))],
            // The type bits are composed rather than read off `mode`, which
            // carries them on some filesystems and not others, the same
            // reason `formatMode` is passed `isDirectory` separately.
            [
              "f",
              {
                kind: "hex",
                value:
                  (stat.isDirectory ? 0o040000 : 0o100000) |
                  (stat.mode & 0o7777),
              },
            ],
            ["u", { kind: "uint", value: 1000 }],
            ["U", text("user")],
            ["g", { kind: "uint", value: 1000 }],
            ["G", text("group")],
            ["Y", { kind: "epoch", ms: mtime }],
            // Birth time is not recorded, which GNU renders as `-` and `0`.
            // Access and change times are not either, and they are left to
            // the `?` every unanswerable directive gets: reporting the
            // modification time for them would be a plausible wrong answer
            // on a filesystem where the three genuinely differ.
            ["w", text("-")],
            ["W", { kind: "epoch", ms: 0 }],
          ]);
          // Formatted on demand, so a FORMAT that names no wall clock does
          // not pay for one, and cannot fail a limit its own output fits.
          let wallClock: StatValue | undefined;
          const resolve = (directive: string) => {
            if (directive !== "y") return values.get(directive);
            if (wallClock === undefined) {
              wallClock = text(formatTimestamp(stat.mtime, timezone));
            }
            return wallClock;
          };
          // Scanning FORMAT is linear in its length, so each expansion is
          // charged that length against the loop limit and the work budget.
          if (format.length > ctx.limits.maxLoopIterations) {
            throw new ExecutionLimitError(
              `stat: format work limit exceeded (${ctx.limits.maxLoopIterations})`,
              "iterations",
            );
          }
          ctx.executionScope?.consumeWork(format.length, "stat format");
          let expanded: string;
          try {
            expanded = expandFormat(format, resolve, maxOutputBytes);
          } catch (error) {
            if (!(error instanceof InvalidDirectiveError)) throw error;
            // GNU stops at the first invalid directive, after printing the
            // part of FORMAT before it.
            appendStdout(error.output);
            return { stdout, stderr: stderr + error.message, exitCode: 1 };
          }
          appendStdout(`${expanded}\n`);
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
