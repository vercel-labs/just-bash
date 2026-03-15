import type { Command, CommandResult } from "../../types.js";
import { parseArgs } from "../../utils/args.js";
import { hasHelpFlag, showHelp } from "../help.js";

const catHelp = {
  name: "cat",
  summary: "concatenate files and print on the standard output",
  usage: "cat [OPTION]... [FILE]...",
  options: [
    "-n, --number           number all output lines",
    "    --help             display this help and exit",
  ],
};

const argDefs = {
  number: { short: "n", long: "number", type: "boolean" as const },
};

export const catCommand: Command = {
  name: "cat",
  streaming: true,

  async execute(args, ctx): Promise<CommandResult> {
    if (hasHelpFlag(args)) {
      return showHelp(catHelp);
    }

    const parsed = parseArgs("cat", args, argDefs);
    if (!parsed.ok) return parsed.error;

    const showLineNumbers = parsed.result.flags.number;
    const files = parsed.result.positional;

    let exitCode = 0;
    let lineNumber = 1;
    let isReadingFiles = false;

    async function writeContent(content: string): Promise<void> {
      if (showLineNumbers) {
        const numbered = addLineNumbers(content, lineNumber);
        lineNumber = numbered.nextLineNumber;
        await ctx.writeStdout(numbered.content);
      } else {
        await ctx.writeStdout(content);
      }
    }

    async function drainStdin(): Promise<void> {
      for await (const chunk of ctx.stdinStream) {
        await writeContent(chunk);
      }
    }

    if (files.length === 0) {
      await drainStdin();
    } else {
      for (const file of files) {
        if (file === "-") {
          await drainStdin();
        } else {
          isReadingFiles = true;
          try {
            const filePath = ctx.fs.resolvePath(ctx.cwd, file);
            for await (const chunk of ctx.fs.createReadStream(filePath, {
              encoding: "binary",
            })) {
              await writeContent(chunk);
            }
          } catch {
            await ctx.writeStderr(`cat: ${file}: No such file or directory\n`);
            exitCode = 1;
          }
        }
      }
    }

    return {
      exitCode,
      // @banned-pattern-ignore: spread into static result keys, no user-controlled properties
      ...(isReadingFiles ? { stdoutEncoding: "binary" as const } : {}),
    };
  },
};

function addLineNumbers(
  content: string,
  startLine: number,
): { content: string; nextLineNumber: number } {
  const lines = content.split("\n");
  // Don't number the trailing empty line if file ends with newline
  const hasTrailingNewline = content.endsWith("\n");
  const linesToNumber = hasTrailingNewline ? lines.slice(0, -1) : lines;

  const numbered = linesToNumber.map((line, i) => {
    const num = String(startLine + i).padStart(6, " ");
    return `${num}\t${line}`;
  });

  return {
    content: numbered.join("\n") + (hasTrailingNewline ? "\n" : ""),
    nextLineNumber: startLine + linesToNumber.length,
  };
}

import type { CommandFuzzInfo } from "../fuzz-flags-types.js";

export const flagsForFuzzing: CommandFuzzInfo = {
  name: "cat",
  flags: [
    { flag: "-n", type: "boolean" },
    { flag: "-A", type: "boolean" },
    { flag: "-b", type: "boolean" },
    { flag: "-s", type: "boolean" },
    { flag: "-v", type: "boolean" },
    { flag: "-e", type: "boolean" },
    { flag: "-t", type: "boolean" },
  ],
  stdinType: "text",
  needsFiles: true,
};
