import { latin1FromBytes } from "../../encoding.js";
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
      // cat is byte-clean: emit raw bytes unchanged. The output boundary
      // (Bash.exec) decodes UTF-8 sequences back to Unicode for terminals.
      const bytes = latin1FromBytes(content);
      if (showLineNumbers) {
        // Real bash continues line numbers across files
        const result = addLineNumbers(bytes, lineNumber);
        stdout += result.content;
        lineNumber = result.nextLineNumber;
      } else {
        stdout += bytes;
      }
    }

    // cat is byte-clean: it forwards every byte of stdin / file content
    // unchanged. Mark stdout binary unconditionally so the pipeline glue
    // doesn't UTF-8-encode the bytes a second time when the next stage
    // happens to be a byte consumer, and so `> /file` redirects skip the
    // smart-utf8 encoding path that would otherwise double-encode.
    return {
      stdout,
      stderr: readResult.stderr,
      exitCode: readResult.exitCode,
      stdoutEncoding: "binary",
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
