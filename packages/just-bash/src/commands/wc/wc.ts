import {
  type ByteString,
  decodeBytesToUtf8,
  latin1FromBytes,
} from "../../encoding.js";
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
    let showBytes = parsed.result.flags.bytes;
    const showChars = parsed.result.flags.chars;
    const files = parsed.result.positional;

    // If no flags specified, default to lines + words + bytes (-c).
    if (!showLines && !showWords && !showBytes && !showChars) {
      showLines = showWords = showBytes = true;
    }
    // The third column is either bytes or chars, depending on flag.
    const showThird = showBytes || showChars;

    // Read files
    const readResult = await readFiles(ctx, files, {
      cmdName: "wc",
      stopOnError: false,
    });

    // If reading from stdin (no files), use simpler output
    if (files.length === 0) {
      const stats = countStats(readResult.files[0].content, showChars);
      return {
        stdout: `${formatStats(stats, showLines, showWords, showThird, "", 0)}\n`,
        stderr: "",
        exitCode: 0,
      };
    }

    // First pass: count stats for all files and calculate max widths
    const allStats: Array<{
      filename: string;
      stats: { lines: number; words: number; third: number };
    }> = [];
    let totalLines = 0;
    let totalWords = 0;
    let totalThird = 0;

    for (const { filename, content } of readResult.files) {
      const stats = countStats(content, showChars);
      totalLines += stats.lines;
      totalWords += stats.words;
      totalThird += stats.third;
      allStats.push({ filename, stats });
    }

    // Calculate the max width needed for alignment
    // Consider totals if we have multiple files
    const maxLines =
      files.length > 1
        ? totalLines
        : Math.max(...allStats.map((s) => s.stats.lines));
    const maxWords =
      files.length > 1
        ? totalWords
        : Math.max(...allStats.map((s) => s.stats.words));
    const maxThird =
      files.length > 1
        ? totalThird
        : Math.max(...allStats.map((s) => s.stats.third));

    // Calculate width based on which columns are shown
    // Use minimum width of 3 for alignment when there are multiple files (matches osh behavior)
    let maxWidth = files.length > 1 ? 3 : 0;
    if (showLines) maxWidth = Math.max(maxWidth, String(maxLines).length);
    if (showWords) maxWidth = Math.max(maxWidth, String(maxWords).length);
    if (showThird) maxWidth = Math.max(maxWidth, String(maxThird).length);

    // Second pass: format output with proper alignment
    let stdout = "";
    for (const { filename, stats } of allStats) {
      stdout += `${formatStats(stats, showLines, showWords, showThird, filename, maxWidth)}\n`;
    }

    // Show total for multiple files
    if (files.length > 1) {
      stdout += `${formatStats(
        { lines: totalLines, words: totalWords, third: totalThird },
        showLines,
        showWords,
        showThird,
        "total",
        maxWidth,
      )}\n`;
    }

    return { stdout, stderr: readResult.stderr, exitCode: readResult.exitCode };
  },
};

/**
 * Count line / word / third-column stats. The third column is bytes for
 * `-c` and Unicode codepoints for `-m`. Words and lines are byte-clean —
 * `\n` / whitespace are ASCII so they never collide with multibyte UTF-8
 * continuation or leading bytes.
 *
 * We use string `.length` for the byte count rather than UTF-8 re-encoding.
 * In the typical pipeline path each char represents one byte (latin1 shape)
 * so `.length` IS the byte count. In the rare path where an upstream
 * already decoded to Unicode, we accept that `-c` reports JS code units —
 * that matches real bash's `wc -c` byte count for ASCII / latin1 input,
 * preserves existing behavior for invalid-UTF-8 binary input that the
 * redirect layer mapped to U+FFFD, and stays consistent with the rest of
 * the pipeline's byte-shaped string semantics.
 */
function countStats(
  content: ByteString,
  countCodepoints: boolean,
): {
  lines: number;
  words: number;
  third: number;
} {
  const bytes = latin1FromBytes(content);
  const len = bytes.length;
  const third = countCodepoints
    ? Array.from(decodeBytesToUtf8(content)).length
    : len;
  let lines = 0;
  let words = 0;
  let inWord = false;

  // Single pass through content to count lines and words
  for (let i = 0; i < len; i++) {
    const c = bytes[i];
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

  return { lines, words, third };
}

function formatStats(
  stats: { lines: number; words: number; third: number },
  showLines: boolean,
  showWords: boolean,
  showThird: boolean,
  filename: string,
  minWidth: number,
): string {
  const values: string[] = [];
  if (showLines) {
    values.push(String(stats.lines).padStart(minWidth));
  }
  if (showWords) {
    values.push(String(stats.words).padStart(minWidth));
  }
  if (showThird) {
    values.push(String(stats.third).padStart(minWidth));
  }

  let result = values.join(" ");
  if (filename) {
    result += ` ${filename}`;
  }

  return result;
}

import type { CommandFuzzInfo } from "../fuzz-flags-types.js";

export const flagsForFuzzing: CommandFuzzInfo = {
  name: "wc",
  flags: [
    { flag: "-l", type: "boolean" },
    { flag: "-w", type: "boolean" },
    { flag: "-c", type: "boolean" },
    { flag: "-m", type: "boolean" },
  ],
  stdinType: "text",
  needsFiles: true,
};
