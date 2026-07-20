/**
 * join - join lines of two files on a common field
 *
 * Usage: join [OPTION]... FILE1 FILE2
 *
 * For each pair of input lines with identical join fields, write a line to
 * standard output. The default join field is the first, delimited by blanks.
 */

import {
  decodeBytesToUtf8,
  encodeUtf8ToBytes,
  latin1FromBytes,
} from "../../encoding.js";
import { ExecutionLimitError } from "../../interpreter/errors.js";
import type {
  ExecResult,
  RuntimeCommand,
  RuntimeCommandContext,
} from "../../types.js";
import { hasHelpFlag, showHelp, unknownOption } from "../help.js";
import { utf8ByteLength } from "../printf/escapes.js";

const joinHelp = {
  name: "join",
  summary: "join lines of two files on a common field",
  usage: "join [OPTION]... FILE1 FILE2",
  description:
    "For each pair of input lines with identical join fields, write a line to standard output. The default join field is the first, delimited by blanks.",
  options: [
    "-1 FIELD     Join on this FIELD of file 1 (default: 1)",
    "-2 FIELD     Join on this FIELD of file 2 (default: 1)",
    "-t CHAR      Use CHAR as input and output field separator",
    "-a FILENUM   Also print unpairable lines from file FILENUM (1 or 2)",
    "-v FILENUM   Like -a but only output unpairable lines",
    "-e STRING    Replace missing fields with STRING",
    "-o FORMAT    Output format (comma-separated list of FILENUM.FIELD)",
    "-i           Ignore case when comparing fields",
  ],
  examples: [
    "join file1 file2               # Join on first field",
    "join -1 2 -2 1 file1 file2     # Join file1 col 2 with file2 col 1",
    "join -t ',' file1.csv file2.csv  # Join CSV files",
    "join -a 1 file1 file2          # Left outer join",
  ],
};

interface JoinOptions {
  field1: number; // 1-based field number
  field2: number;
  separator: string | null; // null = whitespace
  printUnpairable: Set<number>; // 1, 2, or both
  onlyUnpairable: Set<number>;
  emptyString: string;
  outputFormat: Array<{ file: number; field: number }> | null;
  ignoreCase: boolean;
}

interface ParsedLine {
  fields: string[];
  joinKey: string;
  original: string;
}

/**
 * Split a line into fields based on separator.
 */
function splitLine(line: string, separator: string | null): string[] {
  if (separator) {
    return line.split(separator);
  }
  // Whitespace: split on runs of whitespace, filtering empty strings
  return line.split(/[ \t]+/).filter((f) => f.length > 0);
}

/**
 * Parse a line into fields and extract the join key.
 */
function parseLine(
  line: string,
  separator: string | null,
  joinField: number,
  ignoreCase: boolean,
): ParsedLine {
  const fields = splitLine(line, separator);
  let joinKey = fields[joinField - 1] ?? "";
  if (ignoreCase) {
    joinKey = joinKey.toLowerCase();
  }
  return { fields, joinKey, original: line };
}

/**
 * Format output line based on format spec or defaults.
 */
function formatOutputLine(
  line1: ParsedLine | null,
  line2: ParsedLine | null,
  options: JoinOptions,
): string {
  const sep = options.separator ?? " ";

  if (options.outputFormat) {
    // Custom format: output specified fields
    const parts: string[] = [];
    for (const { file, field } of options.outputFormat) {
      const line = file === 1 ? line1 : line2;
      if (line && field === 0) {
        // 0 means the join field
        parts.push(line.joinKey);
      } else if (line && line.fields[field - 1] !== undefined) {
        parts.push(line.fields[field - 1]);
      } else {
        parts.push(options.emptyString);
      }
    }
    return parts.join(sep);
  }

  // Default format: join field, then all fields from file1 (except join),
  // then all fields from file2 (except join)
  const parts: string[] = [];

  // The join field
  const joinField = line1?.joinKey ?? line2?.joinKey ?? "";
  parts.push(joinField);

  // All fields from file1 except the join field
  if (line1) {
    for (let i = 0; i < line1.fields.length; i++) {
      if (i !== options.field1 - 1) {
        parts.push(line1.fields[i]);
      }
    }
  }

  // All fields from file2 except the join field
  if (line2) {
    for (let i = 0; i < line2.fields.length; i++) {
      if (i !== options.field2 - 1) {
        parts.push(line2.fields[i]);
      }
    }
  }

  return parts.join(sep);
}

/**
 * Parse output format specification like "1.1,1.2,2.1"
 */
function parseOutputFormat(
  format: string,
): Array<{ file: number; field: number }> | null {
  const parts = format.split(",");
  const result: Array<{ file: number; field: number }> = [];

  for (const part of parts) {
    const match = part.trim().match(/^(\d+)\.(\d+)$/);
    if (!match) {
      return null;
    }
    const file = Number.parseInt(match[1], 10);
    const field = Number.parseInt(match[2], 10);
    if (file !== 1 && file !== 2) {
      return null;
    }
    result.push({ file, field });
  }

  return result;
}

export const join: RuntimeCommand = {
  name: "join",
  execute: async (
    args: string[],
    ctx: RuntimeCommandContext,
  ): Promise<ExecResult> => {
    if (hasHelpFlag(args)) {
      return showHelp(joinHelp);
    }

    const options: JoinOptions = {
      field1: 1,
      field2: 1,
      separator: null,
      printUnpairable: new Set(),
      onlyUnpairable: new Set(),
      emptyString: "",
      outputFormat: null,
      ignoreCase: false,
    };

    const files: string[] = [];
    let i = 0;

    while (i < args.length) {
      const arg = args[i];

      if (arg === "-1" && i + 1 < args.length) {
        const field = Number.parseInt(args[i + 1], 10);
        if (Number.isNaN(field) || field < 1) {
          return {
            exitCode: 1,
            stdout: "",
            stderr: `join: invalid field number: '${args[i + 1]}'\n`,
          };
        }
        options.field1 = field;
        i += 2;
      } else if (arg === "-2" && i + 1 < args.length) {
        const field = Number.parseInt(args[i + 1], 10);
        if (Number.isNaN(field) || field < 1) {
          return {
            exitCode: 1,
            stdout: "",
            stderr: `join: invalid field number: '${args[i + 1]}'\n`,
          };
        }
        options.field2 = field;
        i += 2;
      } else if (
        (arg === "-t" || arg === "--field-separator") &&
        i + 1 < args.length
      ) {
        options.separator = args[i + 1];
        i += 2;
      } else if (arg.startsWith("-t") && arg.length > 2) {
        options.separator = arg.slice(2);
        i++;
      } else if (arg === "-a" && i + 1 < args.length) {
        const fileNum = Number.parseInt(args[i + 1], 10);
        if (fileNum !== 1 && fileNum !== 2) {
          return {
            exitCode: 1,
            stdout: "",
            stderr: `join: invalid file number: '${args[i + 1]}'\n`,
          };
        }
        options.printUnpairable.add(fileNum);
        i += 2;
      } else if (arg.match(/^-a[12]$/)) {
        options.printUnpairable.add(Number.parseInt(arg[2], 10));
        i++;
      } else if (arg === "-v" && i + 1 < args.length) {
        const fileNum = Number.parseInt(args[i + 1], 10);
        if (fileNum !== 1 && fileNum !== 2) {
          return {
            exitCode: 1,
            stdout: "",
            stderr: `join: invalid file number: '${args[i + 1]}'\n`,
          };
        }
        options.onlyUnpairable.add(fileNum);
        i += 2;
      } else if (arg.match(/^-v[12]$/)) {
        options.onlyUnpairable.add(Number.parseInt(arg[2], 10));
        i++;
      } else if (arg === "-e" && i + 1 < args.length) {
        options.emptyString = args[i + 1];
        i += 2;
      } else if (arg === "-o" && i + 1 < args.length) {
        const format = parseOutputFormat(args[i + 1]);
        if (!format) {
          return {
            exitCode: 1,
            stdout: "",
            stderr: `join: invalid field spec: '${args[i + 1]}'\n`,
          };
        }
        options.outputFormat = format;
        i += 2;
      } else if (arg === "-i" || arg === "--ignore-case") {
        options.ignoreCase = true;
        i++;
      } else if (arg === "--") {
        files.push(...args.slice(i + 1));
        break;
      } else if (arg.startsWith("-") && arg !== "-") {
        return unknownOption("join", arg);
      } else {
        files.push(arg);
        i++;
      }
    }

    // Need exactly 2 files
    if (files.length !== 2) {
      return {
        exitCode: 1,
        stdout: "",
        stderr:
          files.length < 2
            ? "join: missing file operand\n"
            : "join: extra operand\n",
      };
    }

    // Read both files. join compares the key field as a string; normalize
    // stdin (byte buffer) to UTF-8 so it compares against file content (utf8
    // by default) correctly when the data carries multibyte chars.
    const contents: string[] = [];
    for (const file of files) {
      if (file === "-") {
        contents.push(decodeBytesToUtf8(ctx.stdin) ?? "");
      } else {
        const filePath = ctx.fs.resolvePath(ctx.cwd, file);
        const content = await ctx.fs.readFile(filePath);
        if (content === null) {
          return {
            exitCode: 1,
            stdout: "",
            stderr: `join: ${file}: No such file or directory\n`,
          };
        }
        contents.push(content);
      }
    }

    const maxArrayElements = ctx.limits.maxArrayElements;
    const maxIterations = ctx.limits.maxLoopIterations;
    const maxStringLength = Math.min(
      ctx.limits.maxInputBytes,
      ctx.limits.maxStringLength,
    );
    const maxOutputSize = Math.min(
      ctx.limits.maxOutputSize,
      ctx.limits.maxStringLength,
    );
    const aggregateInputBytes = contents.reduce(
      (total, content) => total + utf8ByteLength(content),
      0,
    );
    if (aggregateInputBytes > maxStringLength) {
      throw new ExecutionLimitError(
        `join: aggregate input size limit exceeded (${maxStringLength} bytes)`,
        "string_length",
      );
    }
    let parsedLineCount = 0;
    let iterations = 0;
    const useIteration = (): void => {
      if (++iterations > maxIterations) {
        throw new ExecutionLimitError(
          `join: iteration limit exceeded (${maxIterations})`,
          "iterations",
        );
      }
    };

    // Parse lines from both files
    const parseLines = (content: string, joinField: number): ParsedLine[] => {
      let lineCount = content.length > 0 ? 1 : 0;
      for (let i = 0; i < content.length; i++) {
        if (content.charCodeAt(i) === 10 && i + 1 < content.length) lineCount++;
      }
      if (lineCount > maxArrayElements - parsedLineCount) {
        throw new ExecutionLimitError(
          `join: array element limit exceeded (${maxArrayElements})`,
          "array_elements",
        );
      }
      parsedLineCount += lineCount;
      const lines = content.split("\n");
      if (content.endsWith("\n") && lines[lines.length - 1] === "") {
        lines.pop();
      }
      return lines
        .filter((line) => line.length > 0)
        .map((line) =>
          parseLine(line, options.separator, joinField, options.ignoreCase),
        );
    };

    const lines1 = parseLines(contents[0], options.field1);
    const lines2 = parseLines(contents[1], options.field2);

    // Build index of file2 lines by join key (for efficient lookup)
    const index2 = new Map<string, ParsedLine[]>();
    for (const line of lines2) {
      const existing = index2.get(line.joinKey);
      if (existing) {
        existing.push(line);
      } else {
        index2.set(line.joinKey, [line]);
      }
    }

    const output: string[] = [];
    let outputBytes = 0;
    const appendOutput = (line: string): void => {
      useIteration();
      if (output.length >= maxArrayElements) {
        throw new ExecutionLimitError(
          `join: array element limit exceeded (${maxArrayElements})`,
          "array_elements",
        );
      }
      const lineBytes = utf8ByteLength(line) + 1;
      if (lineBytes > maxOutputSize - outputBytes) {
        throw new ExecutionLimitError(
          `join: output size limit exceeded (${maxOutputSize} bytes)`,
          "output_size",
        );
      }
      output.push(line);
      outputBytes += lineBytes;
    };
    const matchedKeys2 = new Set<string>();

    // Process file1 lines
    for (const line1 of lines1) {
      const matches = index2.get(line1.joinKey);

      if (matches && matches.length > 0) {
        // Found matches
        matchedKeys2.add(line1.joinKey);

        if (options.onlyUnpairable.size === 0) {
          // Output joined lines (unless we only want unpairable)
          for (const line2 of matches) {
            appendOutput(formatOutputLine(line1, line2, options));
          }
        }
      } else {
        // No match - print if -a1 or -v1
        if (options.printUnpairable.has(1) || options.onlyUnpairable.has(1)) {
          appendOutput(formatOutputLine(line1, null, options));
        }
      }
    }

    // Print unpairable lines from file2 if requested
    if (options.printUnpairable.has(2) || options.onlyUnpairable.has(2)) {
      for (const line2 of lines2) {
        if (!matchedKeys2.has(line2.joinKey)) {
          appendOutput(formatOutputLine(null, line2, options));
        }
      }
    }

    // Re-encode decoded UTF-8 to a latin1 byte view so byte consumers downstream and redirects don't double-encode.
    return {
      exitCode: 0,
      stdout: latin1FromBytes(
        encodeUtf8ToBytes(output.length > 0 ? `${output.join("\n")}\n` : ""),
      ),
      stderr: "",
      stdoutEncoding: "binary",
    };
  },
};

import type { CommandFuzzInfo } from "../fuzz-flags-types.js";

export const flagsForFuzzing: CommandFuzzInfo = {
  name: "join",
  flags: [
    { flag: "-1", type: "value", valueHint: "number" },
    { flag: "-2", type: "value", valueHint: "number" },
    { flag: "-t", type: "value", valueHint: "delimiter" },
    { flag: "-a", type: "value", valueHint: "number" },
    { flag: "-v", type: "value", valueHint: "number" },
    { flag: "-e", type: "value", valueHint: "string" },
    { flag: "-o", type: "value", valueHint: "format" },
    { flag: "-i", type: "boolean" },
  ],
  needsArgs: true,
  minArgs: 2,
};
