/**
 * nl - number lines of files
 *
 * Usage: nl [OPTION]... [FILE]...
 *
 * Write each FILE to standard output, with line numbers added.
 * If no FILE is specified, standard input is read.
 */

import { decodeBytesToUtf8, utf8ByteLength } from "../../encoding.js";
import { ExecutionLimitError } from "../../interpreter/errors.js";
import type {
  ExecResult,
  RuntimeCommand,
  RuntimeCommandContext,
} from "../../types.js";
import { hasHelpFlag, showHelp, unknownOption } from "../help.js";

const nlHelp = {
  name: "nl",
  summary: "number lines of files",
  usage: "nl [OPTION]... [FILE]...",
  description:
    "Write each FILE to standard output, with line numbers added. If no FILE is specified, standard input is read.",
  options: [
    "-b STYLE     Body numbering style: a (all), t (non-empty), n (none)",
    "-n FORMAT    Number format: ln (left), rn (right), rz (right zeros)",
    "-w WIDTH     Number width (default: 6)",
    "-s SEP       Separator after number (default: TAB)",
    "-v START     Starting line number (default: 1)",
    "-i INCR      Line number increment (default: 1)",
  ],
  examples: [
    "nl file.txt              # Number non-empty lines",
    "nl -ba file.txt          # Number all lines",
    "nl -n rz -w 3 file.txt   # Right-justified with zeros",
    "nl -s ': ' file.txt      # Use ': ' as separator",
  ],
};

type NumberingStyle = "a" | "t" | "n";
type NumberFormat = "ln" | "rn" | "rz";

interface NlOptions {
  bodyStyle: NumberingStyle;
  numberFormat: NumberFormat;
  width: number;
  separator: string;
  startNumber: number;
  increment: number;
}

function formatLineNumber(
  num: number,
  format: NumberFormat,
  width: number,
): string {
  const numStr = String(num);
  switch (format) {
    case "ln":
      // Left justified
      return numStr.padEnd(width);
    case "rn":
      // Right justified with spaces
      return numStr.padStart(width);
    case "rz":
      // Right justified with zeros
      return numStr.padStart(width, "0");
    default: {
      const _exhaustive: never = format;
      return _exhaustive;
    }
  }
}

function shouldNumber(line: string, style: NumberingStyle): boolean {
  switch (style) {
    case "a":
      return true;
    case "t":
      return line.trim().length > 0;
    case "n":
      return false;
    default: {
      const _exhaustive: never = style;
      return _exhaustive;
    }
  }
}

function processContent(
  content: string,
  options: NlOptions,
  currentNumber: number,
  maxOutputBytes: number,
): { output: string; nextNumber: number } {
  // Handle empty input
  if (content === "") {
    return { output: "", nextNumber: currentNumber };
  }

  const lines = content.split("\n");
  const resultLines: string[] = [];
  let outputBytes = 0;
  let lineNumber = currentNumber;

  // Handle trailing newline
  const hasTrailingNewline =
    content.endsWith("\n") && lines[lines.length - 1] === "";
  if (hasTrailingNewline) {
    lines.pop();
  }

  for (const line of lines) {
    const newlineBytes = resultLines.length > 0 ? 1 : 0;
    const suffixBytes =
      utf8ByteLength(options.separator) + utf8ByteLength(line);
    if (shouldNumber(line, options.bodyStyle)) {
      const prospectiveBytes =
        Math.max(String(lineNumber).length, options.width) +
        suffixBytes +
        newlineBytes;
      if (prospectiveBytes > maxOutputBytes - outputBytes) {
        throw new ExecutionLimitError(
          `nl: output size limit exceeded (${maxOutputBytes} bytes)`,
          "output_size",
        );
      }
      const formattedNum = formatLineNumber(
        lineNumber,
        options.numberFormat,
        options.width,
      );
      const outputLine = `${formattedNum}${options.separator}${line}`;
      resultLines.push(outputLine);
      outputBytes += prospectiveBytes;
      lineNumber += options.increment;
    } else {
      // Empty line without numbering - just add padding spaces for alignment
      const prospectiveBytes = options.width + suffixBytes + newlineBytes;
      if (prospectiveBytes > maxOutputBytes - outputBytes) {
        throw new ExecutionLimitError(
          `nl: output size limit exceeded (${maxOutputBytes} bytes)`,
          "output_size",
        );
      }
      const padding = " ".repeat(options.width);
      const outputLine = `${padding}${options.separator}${line}`;
      resultLines.push(outputLine);
      outputBytes += prospectiveBytes;
    }
  }

  if (hasTrailingNewline && outputBytes + 1 > maxOutputBytes) {
    throw new ExecutionLimitError(
      `nl: output size limit exceeded (${maxOutputBytes} bytes)`,
      "output_size",
    );
  }

  return {
    output: resultLines.join("\n") + (hasTrailingNewline ? "\n" : ""),
    nextNumber: lineNumber,
  };
}

export const nl: RuntimeCommand = {
  name: "nl",
  execute: async (
    args: string[],
    ctx: RuntimeCommandContext,
  ): Promise<ExecResult> => {
    if (hasHelpFlag(args)) {
      return showHelp(nlHelp);
    }

    const options: NlOptions = {
      bodyStyle: "t",
      numberFormat: "rn",
      width: 6,
      separator: "\t",
      startNumber: 1,
      increment: 1,
    };

    const files: string[] = [];
    const maxFieldWidth = Math.min(
      ctx.limits.maxStringLength,
      ctx.limits.maxOutputSize,
    );
    const maxOutputBytes = maxFieldWidth;
    let i = 0;

    while (i < args.length) {
      const arg = args[i];

      if (arg === "-b" && i + 1 < args.length) {
        const style = args[i + 1];
        if (style !== "a" && style !== "t" && style !== "n") {
          return {
            exitCode: 1,
            stdout: "",
            stderr: `nl: invalid body numbering style: '${style}'\n`,
          };
        }
        options.bodyStyle = style;
        i += 2;
      } else if (arg.startsWith("-b")) {
        const style = arg.slice(2);
        if (style !== "a" && style !== "t" && style !== "n") {
          return {
            exitCode: 1,
            stdout: "",
            stderr: `nl: invalid body numbering style: '${style}'\n`,
          };
        }
        options.bodyStyle = style;
        i++;
      } else if (arg === "-n" && i + 1 < args.length) {
        const format = args[i + 1];
        if (format !== "ln" && format !== "rn" && format !== "rz") {
          return {
            exitCode: 1,
            stdout: "",
            stderr: `nl: invalid line numbering format: '${format}'\n`,
          };
        }
        options.numberFormat = format;
        i += 2;
      } else if (arg.startsWith("-n")) {
        const format = arg.slice(2);
        if (format !== "ln" && format !== "rn" && format !== "rz") {
          return {
            exitCode: 1,
            stdout: "",
            stderr: `nl: invalid line numbering format: '${format}'\n`,
          };
        }
        options.numberFormat = format;
        i++;
      } else if (arg === "-w" && i + 1 < args.length) {
        const width = /^\d+$/.test(args[i + 1]) ? Number(args[i + 1]) : NaN;
        if (
          !Number.isSafeInteger(width) ||
          width < 1 ||
          width > maxFieldWidth
        ) {
          return {
            exitCode: 1,
            stdout: "",
            stderr: `nl: invalid line number field width: '${args[i + 1]}'\n`,
          };
        }
        options.width = width;
        i += 2;
      } else if (arg.startsWith("-w")) {
        const width = /^\d+$/.test(arg.slice(2)) ? Number(arg.slice(2)) : NaN;
        if (
          !Number.isSafeInteger(width) ||
          width < 1 ||
          width > maxFieldWidth
        ) {
          return {
            exitCode: 1,
            stdout: "",
            stderr: `nl: invalid line number field width: '${arg.slice(2)}'\n`,
          };
        }
        options.width = width;
        i++;
      } else if (arg === "-s" && i + 1 < args.length) {
        options.separator = args[i + 1];
        i += 2;
      } else if (arg.startsWith("-s")) {
        options.separator = arg.slice(2);
        i++;
      } else if (arg === "-v" && i + 1 < args.length) {
        const start = parseInt(args[i + 1], 10);
        if (Number.isNaN(start)) {
          return {
            exitCode: 1,
            stdout: "",
            stderr: `nl: invalid starting line number: '${args[i + 1]}'\n`,
          };
        }
        options.startNumber = start;
        i += 2;
      } else if (arg.startsWith("-v")) {
        const start = parseInt(arg.slice(2), 10);
        if (Number.isNaN(start)) {
          return {
            exitCode: 1,
            stdout: "",
            stderr: `nl: invalid starting line number: '${arg.slice(2)}'\n`,
          };
        }
        options.startNumber = start;
        i++;
      } else if (arg === "-i" && i + 1 < args.length) {
        const incr = parseInt(args[i + 1], 10);
        if (Number.isNaN(incr)) {
          return {
            exitCode: 1,
            stdout: "",
            stderr: `nl: invalid line number increment: '${args[i + 1]}'\n`,
          };
        }
        options.increment = incr;
        i += 2;
      } else if (arg.startsWith("-i")) {
        const incr = parseInt(arg.slice(2), 10);
        if (Number.isNaN(incr)) {
          return {
            exitCode: 1,
            stdout: "",
            stderr: `nl: invalid line number increment: '${arg.slice(2)}'\n`,
          };
        }
        options.increment = incr;
        i++;
      } else if (arg === "--") {
        files.push(...args.slice(i + 1));
        break;
      } else if (arg.startsWith("-") && arg !== "-") {
        return unknownOption("nl", arg);
      } else {
        files.push(arg);
        i++;
      }
    }

    let output = "";
    let lineNumber = options.startNumber;

    if (files.length === 0) {
      // Read from stdin. nl reads files as utf8 by default; normalize stdin
      // to text so the line-numbered output is consistent with file inputs.
      const input = decodeBytesToUtf8(ctx.stdin) ?? "";
      const result = processContent(input, options, lineNumber, maxOutputBytes);
      output = result.output;
    } else {
      // Process each file
      for (const file of files) {
        const filePath = ctx.fs.resolvePath(ctx.cwd, file);
        const content = await ctx.fs.readFile(filePath);
        if (content === null) {
          return {
            exitCode: 1,
            stdout: output,
            stderr: `nl: ${file}: No such file or directory\n`,
          };
        }
        const result = processContent(
          content,
          options,
          lineNumber,
          maxOutputBytes - utf8ByteLength(output),
        );
        output += result.output;
        lineNumber = result.nextNumber;
      }
    }

    // nl emits text; the pipeline handles encoding.
    return {
      exitCode: 0,
      stdout: output,
      stderr: "",
    };
  },
};

import type { CommandFuzzInfo } from "../fuzz-flags-types.js";

export const flagsForFuzzing: CommandFuzzInfo = {
  name: "nl",
  flags: [
    { flag: "-b", type: "value", valueHint: "string" },
    { flag: "-n", type: "value", valueHint: "string" },
    { flag: "-w", type: "value", valueHint: "number" },
    { flag: "-s", type: "value", valueHint: "string" },
    { flag: "-v", type: "value", valueHint: "number" },
    { flag: "-i", type: "value", valueHint: "number" },
  ],
  stdinType: "text",
  needsFiles: true,
};
