import type { Command, CommandContext, ExecResult } from "../../types.js";
import { parseArgs } from "../../utils/args.js";
import { readFiles } from "../../utils/file-reader.js";
import { hasHelpFlag, showHelp } from "../help.js";

const wcHelp = {
  name: "wc",
  summary: "print newline, word, and byte counts for each file",
  usage: "wc [OPTION]... [FILE]...",
  options: [
    "-c, --bytes      print the byte counts",
    "-m, --chars      print the character counts",
    "-l, --lines      print the newline counts",
    "-w, --words      print the word counts",
    "    --help       display this help and exit",
  ],
};

const argDefs = {
  lines: { short: "l", long: "lines", type: "boolean" as const },
  words: { short: "w", long: "words", type: "boolean" as const },
  bytes: { short: "c", long: "bytes", type: "boolean" as const },
  chars: { short: "m", long: "chars", type: "boolean" as const },
};

export const wcCommand: Command = {
  name: "wc",

  async execute(args: string[], ctx: CommandContext): Promise<ExecResult> {
    if (hasHelpFlag(args)) {
      return showHelp(wcHelp);
    }

    const parsed = parseArgs("wc", args, argDefs);
    if (!parsed.ok) return parsed.error;

    let { lines: showLines, words: showWords } = parsed.result.flags;
    // -c (bytes) and -m (chars) both show character counts
    let showChars = parsed.result.flags.bytes || parsed.result.flags.chars;
    const files = parsed.result.positional;

    // If no flags specified, show all
    if (!showLines && !showWords && !showChars) {
      showLines = showWords = showChars = true;
    }

    // Read files
    const readResult = await readFiles(ctx, files, {
      cmdName: "wc",
      stopOnError: false,
    });

    // If reading from stdin (no files), use simpler output
    if (files.length === 0) {
      const stats = countStats(readResult.files[0].content);
      return {
        stdout: `${formatStats(stats, showLines, showWords, showChars, "")}\n`,
        stderr: "",
        exitCode: 0,
      };
    }

    let stdout = "";
    let totalLines = 0;
    let totalWords = 0;
    let totalChars = 0;

    for (const { filename, content } of readResult.files) {
      const stats = countStats(content);
      totalLines += stats.lines;
      totalWords += stats.words;
      totalChars += stats.chars;
      stdout += `${formatStats(stats, showLines, showWords, showChars, filename)}\n`;
    }

    // Show total for multiple files
    if (files.length > 1) {
      stdout += `${formatStats(
        { lines: totalLines, words: totalWords, chars: totalChars },
        showLines,
        showWords,
        showChars,
        "total",
      )}\n`;
    }

    return { stdout, stderr: readResult.stderr, exitCode: readResult.exitCode };
  },
};

function countStats(content: string): {
  lines: number;
  words: number;
  chars: number;
} {
  const len = content.length;
  let lines = 0;
  let words = 0;
  let inWord = false;

  // Single pass through content to count lines and words
  for (let i = 0; i < len; i++) {
    const c = content[i];
    if (c === "\n") {
      lines++;
      if (inWord) {
        words++;
        inWord = false;
      }
    } else if (c === " " || c === "\t" || c === "\r") {
      if (inWord) {
        words++;
        inWord = false;
      }
    } else {
      inWord = true;
    }
  }

  // Count final word if content doesn't end with whitespace
  if (inWord) {
    words++;
  }

  return { lines, words, chars: len };
}

function formatStats(
  stats: { lines: number; words: number; chars: number },
  showLines: boolean,
  showWords: boolean,
  showChars: boolean,
  filename: string,
): string {
  const values: string[] = [];
  if (showLines) {
    values.push(String(stats.lines));
  }
  if (showWords) {
    values.push(String(stats.words));
  }
  if (showChars) {
    values.push(String(stats.chars));
  }

  let result = values.join(" ");
  if (filename) {
    result += ` ${filename}`;
  }

  return result;
}
