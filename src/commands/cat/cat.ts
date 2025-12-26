import type { Command, CommandContext, ExecResult } from "../../types.js";
import { parseArgs } from "../../utils/args.js";
import { readFiles } from "../../utils/file-reader.js";
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

  async execute(args: string[], ctx: CommandContext): Promise<ExecResult> {
    if (hasHelpFlag(args)) {
      return showHelp(catHelp);
    }

    const parsed = parseArgs("cat", args, argDefs);
    if (!parsed.ok) return parsed.error;

    const showLineNumbers = parsed.result.flags.number;
    const files = parsed.result.positional;

    // Read files (allows "-" for stdin)
    const readResult = await readFiles(ctx, files, {
      cmdName: "cat",
      allowStdinMarker: true,
      stopOnError: false,
    });

    let stdout = "";
    let lineNumber = 1;

    for (const { content } of readResult.files) {
      if (showLineNumbers) {
        // Real bash continues line numbers across files
        const result = addLineNumbers(content, lineNumber);
        stdout += result.content;
        lineNumber = result.nextLineNumber;
      } else {
        stdout += content;
      }
    }

    return { stdout, stderr: readResult.stderr, exitCode: readResult.exitCode };
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
