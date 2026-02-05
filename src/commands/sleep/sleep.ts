import type { Command, CommandContext, ExecResult } from "../../types.js";
import { hasHelpFlag, showHelp } from "../help.js";

const sleepHelp = {
  name: "sleep",
  summary: "delay for a specified amount of time",
  usage: "sleep NUMBER[SUFFIX]",
  description: `Pause for NUMBER seconds. SUFFIX may be:
  s - seconds (default)
  m - minutes
  h - hours
  d - days

NUMBER may be a decimal number.`,
  options: ["    --help display this help and exit"],
};

/**
 * Parse sleep duration string to milliseconds
 */
function parseDuration(arg: string): number | null {
  const match = arg.match(/^(\d+\.?\d*)(s|m|h|d)?$/);
  if (!match) return null;

  const value = parseFloat(match[1]);
  const suffix = match[2] || "s";

  switch (suffix) {
    case "s":
      return value * 1000;
    case "m":
      return value * 60 * 1000;
    case "h":
      return value * 60 * 60 * 1000;
    case "d":
      return value * 24 * 60 * 60 * 1000;
    default:
      return null;
  }
}

export const sleepCommand: Command = {
  name: "sleep",

  async execute(args: string[], ctx: CommandContext): Promise<ExecResult> {
    if (hasHelpFlag(args)) {
      return showHelp(sleepHelp);
    }

    if (args.length === 0) {
      return {
        stdout: "",
        stderr: "sleep: missing operand\n",
        exitCode: 1,
      };
    }

    // Parse all arguments and sum durations (like GNU sleep)
    let totalMs = 0;
    for (const arg of args) {
      const ms = parseDuration(arg);
      if (ms === null) {
        return {
          stdout: "",
          stderr: `sleep: invalid time interval '${arg}'\n`,
          exitCode: 1,
        };
      }
      totalMs += ms;
    }

    // Use mock sleep if available in context, otherwise real setTimeout
    if (ctx.sleep) {
      await ctx.sleep(totalMs);
    } else {
      await new Promise((resolve) => setTimeout(resolve, totalMs));
    }

    return { stdout: "", stderr: "", exitCode: 0 };
  },
};

import type { CommandFuzzInfo } from "../fuzz-flags-types.js";

export const flagsForFuzzing: CommandFuzzInfo = {
  name: "sleep",
  flags: [],
  needsArgs: true,
};
