/**
 * expand - convert tabs to spaces
 *
 * Usage: expand [OPTION]... [FILE]...
 *
 * Convert TABs in each FILE to spaces, writing to standard output.
 * If no FILE is specified, standard input is read.
 */

import { decodeBytesToUtf8 } from "../../encoding.js";
import { ExecutionLimitError } from "../../interpreter/errors.js";
import type {
  ExecResult,
  RuntimeCommand,
  RuntimeCommandContext,
} from "../../types.js";
import { hasHelpFlag, showHelp, unknownOption } from "../help.js";
import { utf8ByteLength } from "../printf/escapes.js";

const expandHelp = {
  name: "expand",
  summary: "convert tabs to spaces",
  usage: "expand [OPTION]... [FILE]...",
  description:
    "Convert TABs in each FILE to spaces, writing to standard output. If no FILE is specified, standard input is read.",
  options: [
    "-t N        Use N spaces per tab (default: 8)",
    "-t LIST     Use comma-separated list of tab stops",
    "-i          Only convert leading tabs on each line",
  ],
  examples: [
    "expand file.txt             # Convert all tabs to 8 spaces",
    "expand -t 4 file.txt        # Use 4-space tabs",
    "expand -t 4,8,12 file.txt   # Custom tab stops",
  ],
};

interface ExpandOptions {
  tabStops: number[];
  leadingOnly: boolean;
}

/**
 * Parse tab stop specification. Can be:
 * - A single number: "4" -> use that as uniform tab width
 * - A comma-separated list: "4,8,12" -> explicit tab stop positions
 */
function parseTabStops(
  spec: string,
  maxTabStop: number,
  maxStops: number,
): number[] | null {
  const parts = spec.split(",").map((s) => s.trim());
  if (parts.length > maxStops) return null;
  const stops: number[] = [];

  for (const part of parts) {
    const num = /^\d+$/.test(part) ? Number(part) : NaN;
    if (!Number.isSafeInteger(num) || num < 1 || num > maxTabStop) {
      return null;
    }
    stops.push(num);
  }

  // Validate that stops are in ascending order
  for (let i = 1; i < stops.length; i++) {
    if (stops[i] <= stops[i - 1]) {
      return null;
    }
  }

  return stops;
}

/**
 * Get the number of spaces to reach the next tab stop from current column.
 * Column positions are 0-based.
 */
function getTabWidth(column: number, tabStops: number[]): number {
  if (tabStops.length === 1) {
    // Single value means uniform tab width
    const tabWidth = tabStops[0];
    return tabWidth - (column % tabWidth);
  }

  // Find the next tab stop position after current column
  for (const stop of tabStops) {
    if (stop > column) {
      return stop - column;
    }
  }

  // If past all explicit stops, use the last interval
  if (tabStops.length >= 2) {
    const lastInterval =
      tabStops[tabStops.length - 1] - tabStops[tabStops.length - 2];
    const lastStop = tabStops[tabStops.length - 1];
    const stopsAfterLast = Math.floor((column - lastStop) / lastInterval) + 1;
    const nextStop = lastStop + stopsAfterLast * lastInterval;
    return nextStop - column;
  }

  // Default: 1 space if past all stops
  return 1;
}

function expandLine(
  line: string,
  options: ExpandOptions,
  maxOutputBytes: number,
): string {
  const { tabStops, leadingOnly } = options;
  let result = "";
  let column = 0;
  let inLeadingWhitespace = true;
  let outputBytes = 0;

  for (const char of line) {
    if (char === "\t") {
      if (leadingOnly && !inLeadingWhitespace) {
        if (outputBytes + 1 > maxOutputBytes) {
          throw new ExecutionLimitError(
            `expand: output size limit exceeded (${maxOutputBytes} bytes)`,
            "output_size",
          );
        }
        result += char;
        outputBytes++;
        column++; // Treat unexpanded tab as 1 column
      } else {
        const spaces = getTabWidth(column, tabStops);
        if (spaces > maxOutputBytes - outputBytes) {
          throw new ExecutionLimitError(
            `expand: output size limit exceeded (${maxOutputBytes} bytes)`,
            "output_size",
          );
        }
        result += " ".repeat(spaces);
        outputBytes += spaces;
        column += spaces;
      }
    } else {
      if (char !== " " && char !== "\t") {
        inLeadingWhitespace = false;
      }
      const charBytes = utf8ByteLength(char);
      if (charBytes > maxOutputBytes - outputBytes) {
        throw new ExecutionLimitError(
          `expand: output size limit exceeded (${maxOutputBytes} bytes)`,
          "output_size",
        );
      }
      result += char;
      outputBytes += charBytes;
      column++;
    }
  }

  return result;
}

function processContent(
  content: string,
  options: ExpandOptions,
  maxOutputBytes: number,
): string {
  if (content === "") {
    return "";
  }

  const lines = content.split("\n");
  const hasTrailingNewline =
    content.endsWith("\n") && lines[lines.length - 1] === "";
  if (hasTrailingNewline) {
    lines.pop();
  }

  const expandedLines: string[] = [];
  let outputBytes = 0;
  for (const line of lines) {
    const newlineBytes = expandedLines.length > 0 ? 1 : 0;
    const expanded = expandLine(
      line,
      options,
      maxOutputBytes - outputBytes - newlineBytes,
    );
    outputBytes += newlineBytes + utf8ByteLength(expanded);
    expandedLines.push(expanded);
  }
  if (hasTrailingNewline && outputBytes + 1 > maxOutputBytes) {
    throw new ExecutionLimitError(
      `expand: output size limit exceeded (${maxOutputBytes} bytes)`,
      "output_size",
    );
  }
  return expandedLines.join("\n") + (hasTrailingNewline ? "\n" : "");
}

export const expand: RuntimeCommand = {
  name: "expand",
  execute: async (
    args: string[],
    ctx: RuntimeCommandContext,
  ): Promise<ExecResult> => {
    if (hasHelpFlag(args)) {
      return showHelp(expandHelp);
    }

    const options: ExpandOptions = {
      tabStops: [8],
      leadingOnly: false,
    };

    const files: string[] = [];
    const maxTabStop = Math.min(
      ctx.limits.maxStringLength,
      ctx.limits.maxOutputSize,
    );
    const maxStops = ctx.limits.maxArrayElements;
    let i = 0;

    while (i < args.length) {
      const arg = args[i];

      if (arg === "-t" && i + 1 < args.length) {
        const stops = parseTabStops(args[i + 1], maxTabStop, maxStops);
        if (!stops) {
          return {
            exitCode: 1,
            stdout: "",
            stderr: `expand: invalid tab size: '${args[i + 1]}'\n`,
          };
        }
        options.tabStops = stops;
        i += 2;
      } else if (arg.startsWith("-t") && arg.length > 2) {
        const stops = parseTabStops(arg.slice(2), maxTabStop, maxStops);
        if (!stops) {
          return {
            exitCode: 1,
            stdout: "",
            stderr: `expand: invalid tab size: '${arg.slice(2)}'\n`,
          };
        }
        options.tabStops = stops;
        i++;
      } else if (arg === "--tabs" && i + 1 < args.length) {
        const stops = parseTabStops(args[i + 1], maxTabStop, maxStops);
        if (!stops) {
          return {
            exitCode: 1,
            stdout: "",
            stderr: `expand: invalid tab size: '${args[i + 1]}'\n`,
          };
        }
        options.tabStops = stops;
        i += 2;
      } else if (arg.startsWith("--tabs=")) {
        const stops = parseTabStops(arg.slice(7), maxTabStop, maxStops);
        if (!stops) {
          return {
            exitCode: 1,
            stdout: "",
            stderr: `expand: invalid tab size: '${arg.slice(7)}'\n`,
          };
        }
        options.tabStops = stops;
        i++;
      } else if (arg === "-i" || arg === "--initial") {
        options.leadingOnly = true;
        i++;
      } else if (arg === "--") {
        files.push(...args.slice(i + 1));
        break;
      } else if (arg.startsWith("-") && arg !== "-") {
        return unknownOption("expand", arg);
      } else {
        files.push(arg);
        i++;
      }
    }

    let output = "";

    if (files.length === 0) {
      // expand counts column positions for tab-stop math; decode bytes so a
      // multibyte char counts as one column rather than 2–4.
      const input = decodeBytesToUtf8(ctx.stdin) ?? "";
      output = processContent(input, options, maxTabStop);
    } else {
      for (const file of files) {
        const filePath = ctx.fs.resolvePath(ctx.cwd, file);
        const content = await ctx.fs.readFile(filePath);
        if (content === null) {
          return {
            exitCode: 1,
            stdout: output,
            stderr: `expand: ${file}: No such file or directory\n`,
          };
        }
        output += processContent(
          content,
          options,
          maxTabStop - utf8ByteLength(output),
        );
      }
    }

    // expand emits text; the pipeline handles encoding.
    return {
      exitCode: 0,
      stdout: output,
      stderr: "",
    };
  },
};

import type { CommandFuzzInfo } from "../fuzz-flags-types.js";

export const flagsForFuzzing: CommandFuzzInfo = {
  name: "expand",
  flags: [
    { flag: "-t", type: "value", valueHint: "number" },
    { flag: "-i", type: "boolean" },
  ],
  stdinType: "text",
  needsFiles: true,
};
