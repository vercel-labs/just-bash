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

function parseDate(s: string): Date | null {
  // @unix-timestamp (GNU extension: date -d @1234567890)
  if (s.startsWith("@")) {
    const ts = Number.parseInt(s.slice(1), 10);
    if (!Number.isNaN(ts)) return new Date(ts * 1000);
  }
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d;
  if (/^\d+$/.test(s)) return new Date(Number.parseInt(s, 10) * 1000);
  const l = s.toLowerCase().trim();
  if (l === "now" || l === "today") return new Date();
  if (l === "yesterday") return new Date(Date.now() - 86400000);
  if (l === "tomorrow") return new Date(Date.now() + 86400000);
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

    const date = dateStr !== null ? parseDate(dateStr) : new Date();
    if (!date)
      return {
        stdout: "",
        stderr: `date: invalid date '${dateStr}'\n`,
        exitCode: 1,
      };

    // -u forces UTC; otherwise use TZ env var if set, else local timezone
    const tz = utc ? "UTC" : ctx.env.get("TZ");
    const ts = Math.floor(date.getTime() / 1000);

    let out: string;
    if (fmt) out = formatStrftime(fmt, ts, tz);
    else if (iso) out = formatStrftime("%Y-%m-%dT%H:%M:%S%z", ts, tz);
    else if (rfc) out = formatStrftime("%a, %d %b %Y %H:%M:%S %z", ts, tz);
    else out = formatStrftime("%a %b %e %H:%M:%S %Z %Y", ts, tz);

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
