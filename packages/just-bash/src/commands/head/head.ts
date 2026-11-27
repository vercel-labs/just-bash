import { latin1FromBytes, unsafeBytesFromLatin1 } from "../../encoding.js";
import type {
  ExecResult,
  RuntimeCommand,
  RuntimeCommandContext,
} from "../../types.js";
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

export const headCommand: RuntimeCommand = {
  name: "head",
  streaming: true,

  async execute(
    args: string[],
    ctx: RuntimeCommandContext,
  ): Promise<ExecResult> {
    if (hasHelpFlag(args)) {
      return showHelp(headHelp);
    }

    const parsed = parseHeadTailArgs(args, "head");
    if (!parsed.ok) {
      return parsed.error;
    }

    const { lines, bytes } = parsed.options;
    if (ctx.stdio && parsed.options.files.length === 0) {
      let remaining = bytes ?? lines;
      while (remaining > 0) {
        const chunk = await ctx.stdio.read();
        if (chunk === null) break;
        const content = latin1FromBytes(chunk);
        const selected = getHead(
          content,
          remaining,
          bytes === null ? null : remaining,
        );
        await ctx.stdio.write(unsafeBytesFromLatin1(selected));
        if (bytes !== null) remaining -= selected.length;
        else for (const byte of selected) if (byte === "\n") remaining--;
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    }

    return processHeadTailFiles(ctx, parsed.options, "head", (content) =>
      getHead(content, lines, bytes),
    );
  },
};

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
