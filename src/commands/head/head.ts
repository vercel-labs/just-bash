import type { Command, CommandContext, ExecResult } from "../../types.js";
import { hasHelpFlag, showHelp } from "../help.js";
import {
  getHead,
  parseHeadTailArgs,
  processHeadTailFiles,
} from "./head-tail-shared.js";

const headHelp = {
  name: "head",
  summary: "output the first part of files",
  usage: "head [OPTION]... [FILE]...",
  options: [
    "-c, --bytes=NUM    print the first NUM bytes",
    "-n, --lines=NUM    print the first NUM lines (default 10)",
    "-q, --quiet        never print headers giving file names",
    "-v, --verbose      always print headers giving file names",
    "    --help         display this help and exit",
  ],
};

export const headCommand: Command = {
  name: "head",
  streaming: true,

  async execute(args: string[], ctx: CommandContext): Promise<ExecResult> {
    if (hasHelpFlag(args)) {
      return showHelp(headHelp);
    }

    const parsed = parseHeadTailArgs(args, "head");
    if (!parsed.ok) {
      return parsed.error;
    }

    const { lines, bytes, files } = parsed.options;

    // Streaming path: read stdin incrementally, abort upstream when done
    if (files.length === 0 && bytes === null) {
      return streamingHead(ctx, lines);
    }

    // Drain stdinStream into buffered stdin only for byte mode from stdin.
    // When file args are present, processHeadTailFiles reads files directly
    // and never uses stdin, so draining is unnecessary.
    if (files.length === 0) {
      let buffered = "";
      for await (const chunk of ctx.stdinStream) {
        buffered += chunk;
      }
      if (buffered) {
        ctx = { ...ctx, stdin: buffered };
      }
    }

    const result = await processHeadTailFiles(
      ctx,
      parsed.options,
      "head",
      (content) => getHead(content, lines, bytes),
    );

    if (result.stdout) {
      await ctx.writeStdout(result.stdout);
      return { stdout: "", stderr: result.stderr, exitCode: result.exitCode };
    }

    return result;
  },
};

/**
 * Streaming head: reads stdin chunks incrementally, counts lines,
 * emits output via writeStdout, and aborts upstream when done.
 */
async function streamingHead(
  ctx: CommandContext,
  targetLines: number,
): Promise<ExecResult> {
  if (targetLines === 0) {
    ctx.abortUpstream?.();
    return { stdout: "", stderr: "", exitCode: 0 };
  }

  const stdinStream = ctx.stdinStream;
  const write = ctx.writeStdout;
  let lineCount = 0;
  let partial = ""; // Leftover partial line from previous chunk

  for await (const chunk of stdinStream) {
    const data = partial + chunk;
    partial = "";

    let pos = 0;
    while (pos < data.length && lineCount < targetLines) {
      const nlIdx = data.indexOf("\n", pos);
      if (nlIdx === -1) {
        // No more newlines — save the rest as partial
        partial = data.slice(pos);
        break;
      }
      lineCount++;
      if (lineCount >= targetLines) {
        // Emit everything from start up to and including this newline
        await write(data.slice(0, nlIdx + 1));
        ctx.abortUpstream?.();
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      pos = nlIdx + 1;
    }

    // Emit all complete lines in this chunk
    if (pos > 0) {
      await write(data.slice(0, pos));
    }
  }

  // Stream ended — emit any remaining partial line
  if (partial && lineCount < targetLines) {
    await write(`${partial}\n`);
  }

  return { stdout: "", stderr: "", exitCode: 0 };
}

import type { CommandFuzzInfo } from "../fuzz-flags-types.js";

export const flagsForFuzzing: CommandFuzzInfo = {
  name: "head",
  flags: [
    { flag: "-n", type: "value", valueHint: "number" },
    { flag: "-c", type: "value", valueHint: "number" },
    { flag: "-q", type: "boolean" },
    { flag: "-v", type: "boolean" },
  ],
  stdinType: "text",
  needsFiles: true,
};
