/**
 * column - columnate lists
 *
 * Usage: column [OPTION]... [FILE]...
 *
 * Columnate input. Fill rows first by default, or create a table with -t.
 */

import { BoundedStringBuilder } from "../../bounded-builder.js";
import { decodeBytesToUtf8, utf8ByteLength } from "../../encoding.js";
import { ExecutionLimitError } from "../../interpreter/errors.js";
import type {
  ExecResult,
  RuntimeCommand,
  RuntimeCommandContext,
} from "../../types.js";
import { parseArgs } from "../../utils/args.js";
import { hasHelpFlag, showHelp } from "../help.js";

const columnHelp = {
  name: "column",
  summary: "columnate lists",
  usage: "column [OPTION]... [FILE]...",
  description:
    "Format input into multiple columns. By default, fills rows first. Use -t to create a table based on whitespace-delimited input.",
  options: [
    "-t           Create a table (determine columns from input)",
    "-s SEP       Input field delimiter (default: whitespace)",
    "-o SEP       Output field delimiter (default: two spaces)",
    "-c WIDTH     Output width for fill mode (default: 80)",
    "-n           Don't merge multiple adjacent delimiters",
  ],
  examples: [
    "ls | column              # Fill columns with ls output",
    "cat data | column -t     # Format as table",
    "column -t -s ',' file    # Format CSV as table",
    "column -c 40 file        # Fill 40-char wide columns",
  ],
};

const argDefs = {
  table: { short: "t", long: "table", type: "boolean" as const },
  separator: { short: "s", type: "string" as const },
  outputSep: { short: "o", type: "string" as const },
  width: { short: "c", type: "number" as const, default: 80 },
  noMerge: { short: "n", type: "boolean" as const },
};

/**
 * Split a line into fields based on separator.
 * If noMerge is false, consecutive delimiters are treated as one.
 */
function splitFields(
  line: string,
  separator: string | undefined,
  noMerge: boolean,
  limit: number,
): string[] {
  if (separator) {
    if (noMerge) {
      return line.split(separator, limit);
    }
    // Split by separator, removing empty fields from consecutive separators
    return line.split(separator, limit).filter((f) => f.length > 0);
  }

  // Default: split by whitespace
  if (noMerge) {
    // With -n, preserve empty fields between whitespace
    return line.split(/[ \t]/, limit);
  }
  // Default: consecutive whitespace is one delimiter
  return line.split(/[ \t]+/, limit).filter((f) => f.length > 0);
}

/**
 * Calculate the maximum width for each column.
 */
function calculateColumnWidths(rows: string[][]): number[] {
  const widths: number[] = [];

  for (const row of rows) {
    for (let i = 0; i < row.length; i++) {
      const cellWidth = row[i].length;
      if (widths[i] === undefined || cellWidth > widths[i]) {
        widths[i] = cellWidth;
      }
    }
  }

  return widths;
}

/**
 * Format rows as a table with aligned columns.
 */
function formatTable(
  rows: string[][],
  outputSep: string,
  maxOutputBytes: number,
): string {
  if (rows.length === 0) return "";

  const widths = calculateColumnWidths(rows);
  const output = new BoundedStringBuilder(
    maxOutputBytes,
    "column",
    undefined,
    1,
  );

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex];
    if (rowIndex > 0) output.append("\n");
    for (let i = 0; i < row.length; i++) {
      if (i > 0) output.append(outputSep);
      output.append(row[i]);
      if (i < row.length - 1) output.repeat(" ", widths[i] - row[i].length);
    }
  }

  return output.build();
}

/**
 * Fill mode: arrange items into columns that fit within width.
 */
function formatFill(
  items: string[],
  width: number,
  outputSep: string,
  maxOutputBytes: number,
): string {
  if (items.length === 0) return "";

  // Find the maximum item width
  let maxItemWidth = 0;
  for (const item of items) maxItemWidth = Math.max(maxItemWidth, item.length);
  const sepWidth = outputSep.length;

  // Calculate how many columns can fit
  // Each column needs maxItemWidth + separator (except last)
  const columnWidth = maxItemWidth + sepWidth;
  const numColumns = Math.max(1, Math.floor((width + sepWidth) / columnWidth));

  // Calculate number of rows
  const numRows = Math.ceil(items.length / numColumns);

  // Build rows, filling column by column (down, then right)
  const output = new BoundedStringBuilder(
    maxOutputBytes,
    "column",
    undefined,
    1,
  );
  for (let row = 0; row < numRows; row++) {
    if (row > 0) output.append("\n");
    let emittedCell = false;
    for (let col = 0; col < numColumns; col++) {
      const index = col * numRows + row;
      if (index < items.length) {
        // Last column in row doesn't need padding
        const isLastInRow =
          col === numColumns - 1 || (col + 1) * numRows + row >= items.length;
        if (isLastInRow) {
          if (emittedCell) output.append(outputSep);
          output.append(items[index]);
        } else {
          if (emittedCell) output.append(outputSep);
          output.append(items[index]);
          output.repeat(" ", maxItemWidth - items[index].length);
        }
        emittedCell = true;
      }
    }
  }

  return output.build();
}

export const column: RuntimeCommand = {
  name: "column",
  execute: async (
    args: string[],
    ctx: RuntimeCommandContext,
  ): Promise<ExecResult> => {
    if (hasHelpFlag(args)) {
      return showHelp(columnHelp);
    }

    const parsed = parseArgs("column", args, argDefs);
    if (!parsed.ok) return parsed.error;

    const { table, separator, outputSep, width, noMerge } = parsed.result.flags;
    const files = parsed.result.positional;

    // Default output separator is two spaces
    const outSep = outputSep ?? "  ";
    const maxInputBytes = Math.min(
      ctx.limits.maxInputBytes,
      ctx.limits.maxStringLength,
    );
    const maxArrayElements = ctx.limits.maxArrayElements;
    const maxOutputBytes = Math.min(
      ctx.limits.maxStringLength,
      ctx.limits.maxOutputSize,
    );
    if (
      !Number.isFinite(width) ||
      !Number.isSafeInteger(width) ||
      width <= 0 ||
      width > 10 * 1024 * 1024
    ) {
      return {
        exitCode: 1,
        stdout: "",
        stderr: `column: invalid width: ${width}\n`,
      };
    }

    // Read input. column uses .length / .padEnd for column widths, which
    // operate on codepoints — decode bytes to UTF-8 so accented / CJK chars
    // count once. (Display-width math for double-wide CJK is still wrong;
    // see follow-up.)
    let content: string;
    if (files.length === 0) {
      content = decodeBytesToUtf8(ctx.stdin) ?? "";
    } else {
      const parts: string[] = [];
      let inputBytes = 0;
      for (const file of files) {
        if (file === "-") {
          const part = decodeBytesToUtf8(ctx.stdin) ?? "";
          inputBytes += utf8ByteLength(part);
          if (inputBytes > maxInputBytes) {
            throw new ExecutionLimitError(
              `column: input size limit exceeded (${maxInputBytes} bytes)`,
              "string_length",
            );
          }
          parts.push(part);
        } else {
          const filePath = ctx.fs.resolvePath(ctx.cwd, file);
          const fileContent = await ctx.fs.readFile(filePath);
          if (fileContent === null) {
            return {
              exitCode: 1,
              stdout: "",
              stderr: `column: ${file}: No such file or directory\n`,
            };
          }
          inputBytes += utf8ByteLength(fileContent);
          if (inputBytes > maxInputBytes) {
            throw new ExecutionLimitError(
              `column: input size limit exceeded (${maxInputBytes} bytes)`,
              "string_length",
            );
          }
          parts.push(fileContent);
        }
      }
      content = parts.join("");
    }
    if (utf8ByteLength(content) > maxInputBytes) {
      throw new ExecutionLimitError(
        `column: input size limit exceeded (${maxInputBytes} bytes)`,
        "string_length",
      );
    }

    // Handle empty input
    if (content === "" || content.trim() === "") {
      return {
        exitCode: 0,
        stdout: "",
        stderr: "",
      };
    }

    // Split into lines, handling trailing newline
    const lines = content.split("\n", maxArrayElements + 1);
    if (lines.length > maxArrayElements) {
      throw new ExecutionLimitError(
        `column: field limit exceeded (${maxArrayElements})`,
        "array_elements",
      );
    }
    const hasTrailingNewline =
      content.endsWith("\n") && lines[lines.length - 1] === "";
    if (hasTrailingNewline) {
      lines.pop();
    }

    // Filter empty lines
    const nonEmptyLines = lines.filter((line) => line.trim().length > 0);

    let output: string;

    if (table) {
      // Table mode: split each line into fields and align
      const rows: string[][] = [];
      let fieldCount = 0;
      for (const line of nonEmptyLines) {
        const remaining = maxArrayElements - fieldCount;
        const fields = splitFields(line, separator, noMerge, remaining + 1);
        fieldCount += fields.length;
        if (fieldCount > maxArrayElements) {
          throw new ExecutionLimitError(
            `column: field limit exceeded (${maxArrayElements})`,
            "array_elements",
          );
        }
        rows.push(fields);
      }
      output = formatTable(rows, outSep, maxOutputBytes);
    } else {
      // Fill mode: collect all items and arrange into columns
      const items: string[] = [];
      for (const line of nonEmptyLines) {
        const remaining = maxArrayElements - items.length;
        const fields = splitFields(line, separator, noMerge, remaining + 1);
        if (fields.length > remaining) {
          throw new ExecutionLimitError(
            `column: field limit exceeded (${maxArrayElements})`,
            "array_elements",
          );
        }
        for (const field of fields) items.push(field);
      }
      output = formatFill(items, width, outSep, maxOutputBytes);
    }

    // Add trailing newline if there was output
    if (output.length > 0) {
      output += "\n";
    }

    // column emits text; the pipeline handles encoding.
    return {
      exitCode: 0,
      stdout: output,
      stderr: "",
    };
  },
};

import type { CommandFuzzInfo } from "../fuzz-flags-types.js";

export const flagsForFuzzing: CommandFuzzInfo = {
  name: "column",
  flags: [
    { flag: "-t", type: "boolean" },
    { flag: "-s", type: "value", valueHint: "delimiter" },
    { flag: "-o", type: "value", valueHint: "string" },
    { flag: "-c", type: "value", valueHint: "number" },
    { flag: "-n", type: "boolean" },
  ],
  stdinType: "text",
  needsFiles: true,
};
