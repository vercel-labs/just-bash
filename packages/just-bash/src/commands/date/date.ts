/**
 * date - Display the current date and time
 */

import type {
  ExecResult,
  RuntimeCommand,
  RuntimeCommandContext,
} from "../../types.js";
import { hasHelpFlag, showHelp, unknownOption } from "../help.js";
import { formatStrftime } from "../printf/strftime.js";
import { isValidTimezone, parseBareISOInTimezone } from "../timezone.js";

const dateHelp = {
  name: "date",
  summary: "display the current time in the given FORMAT",
  usage: "date [OPTION]... [+FORMAT]",
  options: [
    "-d, --date=STRING   display time described by STRING, not 'now'",
    "-u, --utc           print Coordinated Universal Time (UTC)",
    "-I, --iso-8601      output date/time in ISO 8601 format",
    "-R, --rfc-email     output RFC 5322 date format",
    "    --help          display this help and exit",
  ],
};

function parseDate(s: string, tz?: string): Date | null {
  // @unix-timestamp (GNU extension: date -d @1234567890)
  // Require the entire suffix to be numeric to reject partial matches like @0abc.
  if (s.startsWith("@")) {
    const suffix = s.slice(1);
    if (!/^-?\d+$/.test(suffix)) return null;
    const seconds = Number(suffix);
    if (!Number.isSafeInteger(seconds)) return null;
    const date = new Date(seconds * 1000);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const l = s.toLowerCase().trim();
  if (l === "now" || l === "today") return new Date();
  if (l === "yesterday") return new Date(Date.now() - 86400000);
  if (l === "tomorrow") return new Date(Date.now() + 86400000);
  // For bare ISO strings (no explicit offset/Z), interpret in the requested timezone
  if (tz && !/Z$/i.test(s) && !/[+-]\d{2}:?\d{2}$/.test(s)) {
    const d = parseBareISOInTimezone(s, tz);
    if (d) return d;
  }
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d;
  return null;
}

export const dateCommand: RuntimeCommand = {
  name: "date",
  async execute(
    args: string[],
    ctx: RuntimeCommandContext,
  ): Promise<ExecResult> {
    if (hasHelpFlag(args)) return showHelp(dateHelp);

    let utc = false,
      dateStr: string | null = null,
      fmt: string | null = null,
      iso = false,
      rfc = false;

    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === "-u" || a === "--utc") utc = true;
      else if (a === "-d" || a === "--date") dateStr = args[++i] ?? "";
      else if (a.startsWith("--date=")) dateStr = a.slice(7);
      else if (a === "-I" || a === "--iso-8601") iso = true;
      else if (a === "-R" || a === "--rfc-email") rfc = true;
      else if (a.startsWith("+")) fmt = a.slice(1);
      else if (a.startsWith("--")) return unknownOption("date", a);
      else if (a.startsWith("-")) {
        for (const c of a.slice(1)) {
          if (c === "u") utc = true;
          else if (c === "I") iso = true;
          else if (c === "R") rfc = true;
          else return unknownOption("date", `-${c}`);
        }
      }
    }

    // Display-timezone contract:
    //   -u                  -> always UTC.
    //   no $TZ set          -> UTC by default (sandbox non-disclosure default;
    //                          host timezone never leaks unless caller opts in).
    //   $TZ=<valid zone>    -> that zone (validated by isValidTimezone).
    //   $TZ=<invalid zone>  -> UTC fallback (consistent with no-TZ default;
    //                          avoids %Z / %z disagreeing with the displayed
    //                          time parts).
    // parseTz keeps its raw value (undefined when unset) so timezone-naive -d
    // strings without $TZ fall through to JS `new Date(s)` — do NOT propagate
    // the UTC display default into parsing.
    let parseTz = ctx.env.get("TZ");
    if (parseTz && !isValidTimezone(parseTz)) parseTz = undefined;
    const displayTz = utc ? "UTC" : (parseTz ?? "UTC");

    const date = dateStr !== null ? parseDate(dateStr, parseTz) : new Date();
    if (!date)
      return {
        stdout: "",
        stderr: `date: invalid date '${dateStr}'\n`,
        exitCode: 1,
      };

    const ts = Math.floor(date.getTime() / 1000);

    let out: string;
    const strftimeLimits = {
      maxOperations: ctx.limits.maxLoopIterations,
      maxOutputBytes:
        Math.min(ctx.limits.maxStringLength, ctx.limits.maxOutputSize) - 1,
    };
    if (fmt) out = formatStrftime(fmt, ts, displayTz, strftimeLimits);
    else if (iso)
      out = formatStrftime(
        "%Y-%m-%dT%H:%M:%S%z",
        ts,
        displayTz,
        strftimeLimits,
      );
    else if (rfc)
      out = formatStrftime(
        "%a, %d %b %Y %H:%M:%S %z",
        ts,
        displayTz,
        strftimeLimits,
      );
    else
      out = formatStrftime(
        "%a %b %e %H:%M:%S %Z %Y",
        ts,
        displayTz,
        strftimeLimits,
      );

    return { stdout: `${out}\n`, stderr: "", exitCode: 0 };
  },
};

import type { CommandFuzzInfo } from "../fuzz-flags-types.js";

export const flagsForFuzzing: CommandFuzzInfo = {
  name: "date",
  flags: [
    { flag: "-d", type: "value", valueHint: "string" },
    { flag: "-u", type: "boolean" },
    { flag: "-I", type: "boolean" },
    { flag: "-R", type: "boolean" },
  ],
};
