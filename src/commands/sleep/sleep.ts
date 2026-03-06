import { _clearTimeout, _setTimeout } from "../../timers.js";
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

/** Maximum sleep duration: 1 hour (prevents DoS via indefinite blocking) */
const MAX_SLEEP_MS = 3_600_000;

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

    // Cap to prevent indefinite blocking
    if (totalMs > MAX_SLEEP_MS) {
      totalMs = MAX_SLEEP_MS;
    }

    // Check if already aborted before sleeping
    if (ctx.signal?.aborted) {
      return { stdout: "", stderr: "", exitCode: 0 };
    }

    // Use mock sleep if available in context, otherwise real setTimeout
    if (ctx.sleep) {
      await ctx.sleep(totalMs);
    } else if (ctx.signal) {
      // Abort-aware sleep: resolve early if the signal fires
      await new Promise<void>((resolve) => {
        const timer = _setTimeout(resolve, totalMs);
        ctx.signal?.addEventListener(
          "abort",
          () => {
            _clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
      });
    } else {
      await new Promise((resolve) => _setTimeout(resolve, totalMs));
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
