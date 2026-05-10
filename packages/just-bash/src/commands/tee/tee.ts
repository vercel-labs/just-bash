import { latin1FromBytes } from "../../encoding.js";
import type { Command, CommandContext, ExecResult } from "../../types.js";
import { parseArgs } from "../../utils/args.js";
import { hasHelpFlag, showHelp } from "../help.js";

const teeHelp = {
  name: "tee",
  summary: "read from stdin and write to stdout and files",
  usage: "tee [OPTION]... [FILE]...",
  options: [
    "-a, --append     append to the given FILEs, do not overwrite",
    "    --help       display this help and exit",
  ],
};

const argDefs = {
  append: { short: "a", long: "append", type: "boolean" as const },
};

export const teeCommand: Command = {
  name: "tee",

  async execute(args: string[], ctx: CommandContext): Promise<ExecResult> {
    if (hasHelpFlag(args)) {
      return showHelp(teeHelp);
    }

    const parsed = parseArgs("tee", args, argDefs);
    if (!parsed.ok) return parsed.error;

    const { append } = parsed.result.flags;
    const files = parsed.result.positional;
    // tee is byte-clean: stdin bytes are written to each file and the same
    // bytes pass through to stdout.
    const content = latin1FromBytes(ctx.stdin);
    let stderr = "";
    let exitCode = 0;

    // Write to each file in binary mode. The pipe-execution boundary
    // ensures `ctx.stdin` always reaches us as a latin1-shaped byte
    // buffer (UTF-8-encoded for non-ASCII), so binary write preserves the
    // bytes verbatim. Default-utf8 write would re-interpret each char as
    // a codepoint and double-encode every high byte.
    for (const file of files) {
      try {
        const filePath = ctx.fs.resolvePath(ctx.cwd, file);
        if (append) {
          await ctx.fs.appendFile(filePath, content, "binary");
        } else {
          await ctx.fs.writeFile(filePath, content, "binary");
        }
      } catch (_error) {
        stderr += `tee: ${file}: No such file or directory\n`;
        exitCode = 1;
      }
    }

    // Pass through to stdout as raw bytes — the boundary in Bash.exec
    // decodes UTF-8 sequences back to Unicode for terminals.
    return {
      stdout: content,
      stderr,
      exitCode,
      stdoutEncoding: "binary",
    };
  },
};

import type { CommandFuzzInfo } from "../fuzz-flags-types.js";

export const flagsForFuzzing: CommandFuzzInfo = {
  name: "tee",
  flags: [{ flag: "-a", type: "boolean" }],
  stdinType: "text",
  needsArgs: true,
};
