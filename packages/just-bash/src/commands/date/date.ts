/**
 * date - Display the current date and time
 */

import { rethrowFatalExecutionError } from "../../fatal-execution-error.js";
import type {
  ExecResult,
  RuntimeCommand,
  RuntimeCommandContext,
} from "../../types.js";
import { hasHelpFlag, showHelp, unknownOption } from "../help.js";
import { formatStrftime } from "../printf/strftime.js";

const dateHelp = {
  name: "date",
  summary: "display the current time in the given FORMAT",
  usage: "date [OPTION]... [+FORMAT]",
  options: [
    "-d, --date=STRING   display time described by STRING, not 'now'",
    "-r, --reference=FILE  display the last modification time of FILE",
    "-u, --utc           print Coordinated Universal Time (UTC)",
    "-I, --iso-8601      output date/time in ISO 8601 format",
    "-R, --rfc-email     output RFC 5322 date format",
    "    --help          display this help and exit",
  ],
};

/**
 * True iff `tz` is a timezone Intl understands.
 */
export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Resolve an explicit TZ before an optional host default, without exporting it. */
export function commandTimeZone(
  ctx: Pick<RuntimeCommandContext, "env" | "environmentInfo">,
): string {
  const zone = ctx.env.has("TZ")
    ? ctx.env.get("TZ")
    : ctx.environmentInfo?.timeZone;
  return zone && isValidTimezone(zone) ? zone : "UTC";
}

/**
 * Return what `tz` shows at instant `d`, encoded as a UTC Date whose
 * UTC components equal the wall-clock components shown in `tz`.
 * Returns null if Intl rejects the timezone or produces an unparseable date.
 */
function tzShownAsUtc(d: Date, tz: string): Date | null {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  const h = Number.parseInt(get("hour"), 10) % 24;
  const shown = new Date(
    `${get("year")}-${get("month")}-${get("day")}T${String(h).padStart(2, "0")}:${get("minute")}:${get("second")}Z`,
  );
  return Number.isNaN(shown.getTime()) ? null : shown;
}

/**
 * Interpret a bare ISO datetime string (no explicit offset) as if it were
 * in the given named timezone, returning the corresponding UTC Date.
 *
 * Strategy: treat the requested components as a UTC instant, then iteratively
 * refine by asking the timezone what wall-clock it shows at the current
 * candidate and applying the residual delta. Outside DST the loop converges
 * in one pass; across a DST boundary it converges in two. Bounded at 3
 * iterations as a safety net.
 *
 * DST edge cases:
 * - Skipped wall times (spring-forward gaps) do not converge and are rejected.
 * - Ambiguous wall times (fall-back, e.g. America/New_York 2024-11-03T01:30
 *   occurs twice): the seed's first shift uses the offset at the requested
 *   components-as-UTC, which is still EDT for the November case, so the
 *   loop converges on the earlier (EDT) instant.
 */
export function parseBareISOInTimezone(s: string, tz: string): Date | null {
  const m = s.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/,
  );
  if (!m) return null;
  const [, yr, mo, dy, hr = "00", mn = "00", sc = "00"] = m;
  const requested = new Date(`${yr}-${mo}-${dy}T${hr}:${mn}:${sc}Z`);
  if (
    Number.isNaN(requested.getTime()) ||
    requested.getUTCFullYear() !== Number(yr) ||
    requested.getUTCMonth() + 1 !== Number(mo) ||
    requested.getUTCDate() !== Number(dy) ||
    requested.getUTCHours() !== Number(hr) ||
    requested.getUTCMinutes() !== Number(mn) ||
    requested.getUTCSeconds() !== Number(sc)
  )
    return null;
  try {
    let candidate = requested;
    for (let pass = 0; pass < 3; pass++) {
      const shown = tzShownAsUtc(candidate, tz);
      if (shown === null) return null;
      const drift = shown.getTime() - requested.getTime();
      if (drift === 0) return candidate;
      candidate = new Date(candidate.getTime() - drift);
    }
    return null;
  } catch {
    return null;
  }
}

export function parseDate(s: string, tz?: string): Date | null {
  // @unix-timestamp (GNU extension: date -d @1234567890)
  // Require the entire suffix to be numeric to reject partial matches like @0abc.
  if (s.startsWith("@")) {
    const suffix = s.slice(1);
    if (!/^[+-]?\d+(?:\.\d+)?$/.test(suffix)) return null;
    const seconds = Number(suffix);
    if (!Number.isFinite(seconds) || Math.abs(seconds) > 8640000000000)
      return null;
    const date = new Date(seconds * 1000);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const l = s.toLowerCase().trim();
  if (l === "now" || l === "today") return new Date();
  if (l === "yesterday") return new Date(Date.now() - 86400000);
  if (l === "tomorrow") return new Date(Date.now() + 86400000);
  // For bare ISO strings (no explicit offset/Z), interpret in the requested timezone
  if (tz && !/Z$/i.test(s) && !/[+-]\d{2}:?\d{2}$/.test(s)) {
    if (/^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?)?$/.test(s)) {
      return parseBareISOInTimezone(s, tz);
    }
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

    let utc = false;
    let dateStr: string | null = null;
    let reference: string | null = null;
    let fmt: string | null = null;
    let iso: string | null = null;
    let rfc = false;
    const fail = (message: string): ExecResult => ({
      stdout: "",
      stderr: `date: ${message}\n`,
      exitCode: 1,
    });
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === "-u" || a === "--utc" || a === "--universal") utc = true;
      else if (
        a === "-d" ||
        a === "--date" ||
        a === "-r" ||
        a === "--reference"
      ) {
        if (i + 1 >= args.length)
          return fail(`option '${a}' requires an argument`);
        if (a === "-d" || a === "--date") dateStr = args[++i];
        else reference = args[++i];
      } else if (a.startsWith("--date=")) dateStr = a.slice(7);
      else if (a.startsWith("--reference=")) reference = a.slice(12);
      else if (a.startsWith("-d") && !a.startsWith("--")) dateStr = a.slice(2);
      else if (a.startsWith("-r") && !a.startsWith("--"))
        reference = a.slice(2);
      else if (a === "-I" || a === "--iso-8601") iso = "date";
      else if (a.startsWith("--iso-8601=")) iso = a.slice(11);
      else if (a.startsWith("-I")) iso = a.slice(2);
      else if (a === "-R" || a === "--rfc-email" || a === "--rfc-2822")
        rfc = true;
      else if (a.startsWith("+")) {
        if (fmt !== null) return fail(`extra operand '${a}'`);
        fmt = a.slice(1);
      } else if (a.startsWith("--")) return unknownOption("date", a);
      else if (a.startsWith("-")) {
        for (const c of a.slice(1)) {
          if (c === "u") utc = true;
          else if (c === "I") iso = "date";
          else if (c === "R") rfc = true;
          else return unknownOption("date", `-${c}`);
        }
      } else return fail(`extra operand '${a}'`);
    }
    if (
      iso !== null &&
      !["date", "hours", "minutes", "seconds", "ns"].includes(iso)
    ) {
      return fail(`invalid argument '${iso}' for 'ISO 8601 precision'`);
    }
    if (dateStr !== null && reference !== null)
      return fail(
        "the options to specify dates for printing are mutually exclusive\nTry 'date --help' for more information.",
      );
    // Unset TZ stays unset; only an explicit host adapter opts into its timezone.
    const parseTz = utc
      ? "UTC"
      : ctx.env.has("TZ") || ctx.environmentInfo?.timeZone
        ? commandTimeZone(ctx)
        : undefined;
    const displayTz = parseTz ?? "UTC";
    let date: Date | null;
    if (reference !== null) {
      try {
        date = (await ctx.fs.stat(ctx.fs.resolvePath(ctx.cwd, reference)))
          .mtime;
      } catch (error) {
        rethrowFatalExecutionError(error);
        return fail(`${reference}: No such file or directory`);
      }
    } else date = dateStr !== null ? parseDate(dateStr, parseTz) : new Date();
    if (!date) return fail(`invalid date '${dateStr}'`);
    const ts = date.getTime() / 1000;

    let out: string;
    const strftimeLimits = {
      maxOperations: ctx.limits.maxLoopIterations,
      maxOutputBytes:
        Math.min(ctx.limits.maxStringLength, ctx.limits.maxOutputSize) -
        1 -
        (fmt === null && iso !== null && iso !== "date" ? 1 : 0),
    };
    if (fmt !== null) out = formatStrftime(fmt, ts, displayTz, strftimeLimits);
    else if (iso !== null) {
      const precisionFormat = {
        date: "%Y-%m-%d",
        hours: "%Y-%m-%dT%H",
        minutes: "%Y-%m-%dT%H:%M",
        seconds: "%Y-%m-%dT%H:%M:%S",
        ns: "%Y-%m-%dT%H:%M:%S,%N",
      }[iso] as string;
      out = formatStrftime(
        precisionFormat + (iso === "date" ? "" : "%z"),
        ts,
        displayTz,
        strftimeLimits,
      );
      if (iso !== "date") out = `${out.slice(0, -2)}:${out.slice(-2)}`;
    } else if (rfc)
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
