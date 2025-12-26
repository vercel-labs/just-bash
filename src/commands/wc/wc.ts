import type { Command, CommandContext, ExecResult } from "../../types.js";
import { hasHelpFlag, showHelp, unknownOption } from "../help.js";

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

export const wcCommand: Command = {
  name: "wc",

  async execute(args: string[], ctx: CommandContext): Promise<ExecResult> {
    if (hasHelpFlag(args)) {
      return showHelp(wcHelp);
    }

    let showLines = false;
    let showWords = false;
    let showChars = false;
    const files: string[] = [];

    // Parse arguments
    for (const arg of args) {
      if (arg.startsWith("-") && !arg.startsWith("--")) {
        for (const flag of arg.slice(1)) {
          if (flag === "l") showLines = true;
          else if (flag === "w") showWords = true;
          else if (flag === "c" || flag === "m") showChars = true;
          else return unknownOption("wc", `-${flag}`);
        }
      } else if (arg === "--lines") {
        showLines = true;
      } else if (arg === "--words") {
        showWords = true;
      } else if (arg === "--bytes" || arg === "--chars") {
        showChars = true;
      } else if (arg.startsWith("--")) {
        return unknownOption("wc", arg);
      } else {
        files.push(arg);
      }
    }

    // If no flags specified, show all
    if (!showLines && !showWords && !showChars) {
      showLines = showWords = showChars = true;
    }

    // If no files, read from stdin
    if (files.length === 0) {
      const stats = countStats(ctx.stdin);
      return {
        stdout: `${formatStats(stats, showLines, showWords, showChars, "")}\n`,
        stderr: "",
        exitCode: 0,
      };
    }

    let stdout = "";
    let stderr = "";
    let exitCode = 0;
    let totalLines = 0;
    let totalWords = 0;
    let totalChars = 0;

    for (const file of files) {
      try {
        const filePath = ctx.fs.resolvePath(ctx.cwd, file);
        const content = await ctx.fs.readFile(filePath);
        const stats = countStats(content);

        totalLines += stats.lines;
        totalWords += stats.words;
        totalChars += stats.chars;

        stdout += `${formatStats(stats, showLines, showWords, showChars, file)}\n`;
      } catch {
        stderr += `wc: ${file}: No such file or directory\n`;
        exitCode = 1;
      }
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

    return { stdout, stderr, exitCode };
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
