import { boundedJoin, boundedRepeat } from "../../bounded-builder.js";
import { utf8ByteLength } from "../../encoding.js";
import type {
  ExecResult,
  RuntimeCommand,
  RuntimeCommandContext,
} from "../../types.js";
import { showHelp, unknownOption } from "../help.js";

const yesHelp = {
  name: "yes",
  summary: "output a string repeatedly",
  usage: "yes [STRING]...",
  description: [
    "Repeatedly output a line with all specified STRING(s), or 'y'.",
  ],
  options: ["    --help  display this help and exit"],
  notes: [
    "Real yes writes until its reader goes away. Pipelines here are not",
    "streaming — a stage runs to completion before the next one starts — so",
    "yes stops on its own after executionLimits.maxLoopIterations lines, or",
    "earlier if the repeated line would exceed the output size limit.",
    "`yes | head -3` therefore behaves as expected; an unbounded consumer",
    "sees a finite stream.",
  ],
};

export const yesCommand: RuntimeCommand = {
  name: "yes",

  async execute(
    args: string[],
    ctx: RuntimeCommandContext,
  ): Promise<ExecResult> {
    const operands: string[] = [];
    let optionsEnded = false;

    for (const arg of args) {
      if (optionsEnded) {
        operands.push(arg);
        continue;
      }
      if (arg === "--") {
        optionsEnded = true;
        continue;
      }
      if (arg === "--help") {
        return showHelp(yesHelp);
      }
      // A lone "-" is an operand, as in GNU yes; anything else that starts
      // with a dash is an option, even after an operand (getopt permutes).
      // Grouped short options are reported by their first offending letter,
      // the way getopt does: `yes -xy` names 'x', not 'xy'.
      if (arg.startsWith("--")) {
        return unknownOption("yes", arg);
      }
      if (arg.startsWith("-") && arg !== "-") {
        return unknownOption("yes", `-${arg[1]}`);
      }
      operands.push(arg);
    }

    const maxBytes = Math.min(
      ctx.limits.maxStringLength,
      ctx.limits.maxOutputSize,
    );
    // Many large operands can build one huge line, so charge the join too. The
    // newline is charged by the repetition below, which keeps the reported
    // limit equal to the configured one.
    const line =
      operands.length > 0
        ? `${boundedJoin(operands, " ", maxBytes, "yes")}\n`
        : "y\n";
    const fits = Math.floor(maxBytes / utf8ByteLength(line));
    // One line that cannot fit is still attempted, so boundedRepeat reports the
    // output limit rather than silently printing nothing. Zero permitted
    // iterations, on the other hand, means zero lines.
    const lines = Math.min(ctx.limits.maxLoopIterations, Math.max(1, fits));

    return {
      stdout: boundedRepeat(line, lines, maxBytes, "yes"),
      stderr: "",
      exitCode: 0,
    };
  },
};

import type { CommandFuzzInfo } from "../fuzz-flags-types.js";

export const flagsForFuzzing: CommandFuzzInfo = {
  name: "yes",
  flags: [],
};
