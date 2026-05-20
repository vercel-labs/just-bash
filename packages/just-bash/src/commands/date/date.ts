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
 * Interpret a bare ISO datetime string (no explicit offset) as if it were
 * in the given named timezone, returning the corresponding UTC Date.
 *
 * Strategy: treat the components as UTC to get a reference point, ask Intl
 * what that timezone shows at that moment, then shift by the difference so
 * the timezone clock reads the original components.
 */
function parseBareISOInTimezone(s: string, tz: string): Date | null {
  const m = s.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/,
  );
  if (!m) return null;
  const [, yr, mo, dy, hr = "00", mn = "00", sc = "00"] = m;
  const utcRef = new Date(`${yr}-${mo}-${dy}T${hr}:${mn}:${sc}Z`);
  if (Number.isNaN(utcRef.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).formatToParts(utcRef);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
    const h = Number.parseInt(get("hour"), 10) % 24;
    const tzShown = new Date(
      `${get("year")}-${get("month")}-${get("day")}T${String(h).padStart(2, "0")}:${get("minute")}:${get("second")}Z`,
    );
    // Shift utcRef by (utcRef − tzShown) so the TZ clock reads the target value
    return new Date(utcRef.getTime() + (utcRef.getTime() - tzShown.getTime()));
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
    return new Date(Number.parseInt(suffix, 10) * 1000);
  }
  const l = s.toLowerCase().trim();
  if (l === "now" || l === "today") return new Date();
  if (l === "yesterday") return new Date(Date.now() - 86400000);
  if (l === "tomorrow") return new Date(Date.now() + 86400000);
  if (/^\d+$/.test(s)) return new Date(Number.parseInt(s, 10) * 1000);
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

    // TZ env var governs how timezone-naive -d strings are interpreted;
    // -u only overrides the display timezone, not parsing.
    const parseTz = ctx.env.get("TZ");
    const displayTz = utc ? "UTC" : parseTz;

    const date = dateStr !== null ? parseDate(dateStr, parseTz) : new Date();
    if (!date)
      return {
        stdout: "",
        stderr: `date: invalid date '${dateStr}'\n`,
        exitCode: 1,
      };

    const ts = Math.floor(date.getTime() / 1000);

    let out: string;
    if (fmt) out = formatStrftime(fmt, ts, displayTz);
    else if (iso) out = formatStrftime("%Y-%m-%dT%H:%M:%S%z", ts, displayTz);
    else if (rfc)
      out = formatStrftime("%a, %d %b %Y %H:%M:%S %z", ts, displayTz);
    else out = formatStrftime("%a %b %e %H:%M:%S %Z %Y", ts, displayTz);

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
