/**
 * tac - concatenate and print files in reverse
 *
 * Usage: tac [OPTION]... [FILE]...
 *
 * Writes each FILE to standard output, last line first.
 */

import { latin1FromBytes } from "../../encoding.js";
import type {
  ExecResult,
  RuntimeCommand,
  RuntimeCommandContext,
} from "../../types.js";

async function tacExecute(
  args: string[],
  ctx: RuntimeCommandContext,
): Promise<ExecResult> {
  if (args.length > 0 && args[0] !== "-") {
    // Try to read from file
    const filePath = ctx.fs.resolvePath(ctx.cwd, args[0]);
    try {
      const content = await ctx.fs.readFile(filePath);
      const lines = content.split("\n");
      if (lines[lines.length - 1] === "") {
        lines.pop();
      }
      const reversed = lines.reverse();
      return {
        stdout: reversed.length > 0 ? `${reversed.join("\n")}\n` : "",
        stderr: "",
        exitCode: 0,
      };
    } catch {
      return {
        stdout: "",
        stderr: `tac: ${args[0]}: No such file or directory\n`,
        exitCode: 1,
      };
    }
  }

  // Read from stdin. tac is byte-clean — splits on \n then reverses, so the
  // stdin path forwards the original latin1 bytes and must be marked "bytes"
  // (the file path above reads decoded text and stays text-shaped).
  const lines = latin1FromBytes(ctx.stdin).split("\n");
  if (lines[lines.length - 1] === "") {
    lines.pop();
  }
  const reversed = lines.reverse();
  return {
    stdout: reversed.length > 0 ? `${reversed.join("\n")}\n` : "",
    stderr: "",
    exitCode: 0,
    stdoutKind: "bytes",
  };
}

export const tac: RuntimeCommand = {
  name: "tac",
  execute: tacExecute,
};

import type { CommandFuzzInfo } from "../fuzz-flags-types.js";

export const flagsForFuzzing: CommandFuzzInfo = {
  name: "tac",
  flags: [],
  stdinType: "text",
  needsFiles: true,
};
