/**
 * date - Display the current date and time
 */

import type { Command, CommandContext, ExecResult } from "../../types.js";
import { hasHelpFlag, showHelp, unknownOption } from "../help.js";
import { formatStrftime } from "../printf/strftime.js";

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

/**
 * True iff `tz` is a timezone Intl understands. Used to fall back to host-local
 * when `TZ` is set to a value Node's ICU build can't resolve, matching GNU
 * `date` (which silently uses local time on invalid `TZ`).
 */
function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
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
 * - Skipped wall times (spring-forward gap, e.g. America/New_York
 *   2024-03-10T02:30 does not exist): the loop oscillates and we return the
 *   last candidate. In practice this lands on the post-shift (EDT) instant
 *   for the gap.
 * - Ambiguous wall times (fall-back, e.g. America/New_York 2024-11-03T01:30
 *   occurs twice): the seed's first shift uses the offset at the requested
 *   components-as-UTC, which is still EDT for the November case, so the
 *   loop converges on the earlier (EDT) instant.
 */
function parseBareISOInTimezone(s: string, tz: string): Date | null {
  const m = s.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/,
  );
  if (!m) return null;
  const [, yr, mo, dy, hr = "00", mn = "00", sc = "00"] = m;
  const requested = new Date(`${yr}-${mo}-${dy}T${hr}:${mn}:${sc}Z`);
  if (Number.isNaN(requested.getTime())) return null;
  try {
    let candidate = requested;
    for (let pass = 0; pass < 3; pass++) {
      const shown = tzShownAsUtc(candidate, tz);
      if (shown === null) return null;
      const drift = shown.getTime() - requested.getTime();
      if (drift === 0) return candidate;
      candidate = new Date(candidate.getTime() - drift);
    }
    return candidate;
  } catch {
    return null;
  }
}

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

export const dateCommand: Command = {
  name: "date",
  async execute(args: string[], ctx: CommandContext): Promise<ExecResult> {
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
