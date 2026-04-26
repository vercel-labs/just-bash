/**
 * Data utility commands: transpose, shuffle, fixlengths, split, partition
 * Commands that exist in real xan
 */

import Papa from "papaparse";
import type { CommandContext, ExecResult } from "../../types.js";
import {
  type CsvData,
  type CsvRow,
  createSafeRow,
  formatCsv,
  readCsvInput,
  safeSetRow,
} from "./csv.js";

/**
 * Transpose: swap rows and columns
 * Usage: xan transpose [FILE]
 *   First column becomes header row, first row becomes header column
 */
export async function cmdTranspose(
  args: string[],
  ctx: CommandContext,
): Promise<ExecResult> {
  const fileArgs = args.filter((a) => !a.startsWith("-"));

  const { headers, data, error } = await readCsvInput(fileArgs, ctx);
  if (error) return error;

  if (data.length === 0) {
    // Just transpose headers to single column
    const newHeaders = ["column"];
    const newData: CsvData = headers.map((h) => ({ column: h }));
    return { stdout: formatCsv(newHeaders, newData), stderr: "", exitCode: 0 };
  }

  // New headers: first column name + row indices or first column values
  const firstCol = headers[0];
  const newHeaders = [
    firstCol,
    ...data.map((row, i) => String(row[firstCol] ?? `row_${i}`)),
  ];

  // Each remaining column becomes a row
  const newData: CsvData = [];
  for (let i = 1; i < headers.length; i++) {
    const col = headers[i];
    const newRow: CsvRow = createSafeRow();
    safeSetRow(newRow, firstCol, col);
    for (let j = 0; j < data.length; j++) {
      safeSetRow(newRow, newHeaders[j + 1], data[j][col]);
    }
    newData.push(newRow);
  }

  return { stdout: formatCsv(newHeaders, newData), stderr: "", exitCode: 0 };
}

/**
 * Shuffle: randomly reorder rows
 * Usage: xan shuffle [OPTIONS] [FILE]
 *   --seed N    Random seed for reproducibility
 */
export async function cmdShuffle(
  args: string[],
  ctx: CommandContext,
): Promise<ExecResult> {
  let seed: number | null = null;
  const fileArgs: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--seed" && i + 1 < args.length) {
      seed = Number.parseInt(args[++i], 10);
    } else if (!arg.startsWith("-")) {
      fileArgs.push(arg);
    }
  }

  const { headers, data, error } = await readCsvInput(fileArgs, ctx);
  if (error) return error;

  // Simple seeded random (LCG)
  let rng = seed !== null ? seed : Date.now();
  const random = () => {
    rng = (rng * 1103515245 + 12345) & 0x7fffffff;
    return rng / 0x7fffffff;
  };

  // Fisher-Yates shuffle
  const shuffled = [...data];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  return { stdout: formatCsv(headers, shuffled), stderr: "", exitCode: 0 };
}

/**
 * Fixlengths: fix ragged CSV by padding/truncating rows
 * Usage: xan fixlengths [OPTIONS] [FILE]
 *   -l, --length N    Target number of columns (default: max row length)
 *   -d, --default V   Default value for missing fields (default: empty)
 */
export async function cmdFixlengths(
  args: string[],
  ctx: CommandContext,
): Promise<ExecResult> {
  let targetLen: number | null = null;
  let defaultValue = "";
  const fileArgs: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if ((arg === "-l" || arg === "--length") && i + 1 < args.length) {
      targetLen = Number.parseInt(args[++i], 10);
    } else if ((arg === "-d" || arg === "--default") && i + 1 < args.length) {
      defaultValue = args[++i];
    } else if (!arg.startsWith("-")) {
      fileArgs.push(arg);
    }
  }

  // Read raw CSV without assuming headers match data
  const file = fileArgs[0];
  let input: string;

  if (!file || file === "-") {
    input = ctx.stdin;
  } else {
    try {
      const path = ctx.fs.resolvePath(ctx.cwd, file);
      input = await ctx.fs.readFile(path);
    } catch {
      return {
        stdout: "",
        stderr: `xan fixlengths: ${file}: No such file or directory\n`,
        exitCode: 1,
      };
    }
  }

  // Parse without headers to get raw rows
  const result = Papa.parse<string[]>(input.trim(), {
    header: false,
    skipEmptyLines: true,
  });
  const rows = result.data;

  if (rows.length === 0) {
    return { stdout: "", stderr: "", exitCode: 0 };
  }

  // Determine target length
  const maxLen = Math.max(...rows.map((r) => r.length));
  const len = targetLen ?? maxLen;

  // Fix each row
  const fixed = rows.map((row) => {
    if (row.length === len) return row;
    if (row.length < len) {
      return [...row, ...Array(len - row.length).fill(defaultValue)];
    }
    return row.slice(0, len);
  });

  // Output as CSV
  const output = Papa.unparse(fixed);
  return {
    stdout: `${output.replace(/\r\n/g, "\n")}\n`,
    stderr: "",
    exitCode: 0,
  };
}

/**
 * Split: split CSV into multiple files by row count
 * Usage: xan split [OPTIONS] FILE
 *   -c, --chunks N    Split into N equal chunks
 *   -S, --size N      Split into chunks of N rows each
 *   -o, --output DIR  Output directory (default: current)
 *
 * In sandbox mode, outputs as JSON with parts as array
 */
export async function cmdSplit(
  args: string[],
  ctx: CommandContext,
): Promise<ExecResult> {
  let numParts: number | null = null;
  let partSize: number | null = null;
  let outputDir = ".";
  const fileArgs: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if ((arg === "-c" || arg === "--chunks") && i + 1 < args.length) {
      numParts = Number.parseInt(args[++i], 10);
    } else if ((arg === "-S" || arg === "--size") && i + 1 < args.length) {
      partSize = Number.parseInt(args[++i], 10);
    } else if ((arg === "-o" || arg === "--output") && i + 1 < args.length) {
      outputDir = args[++i];
    } else if (!arg.startsWith("-")) {
      fileArgs.push(arg);
    }
  }

  if (!numParts && !partSize) {
    return {
      stdout: "",
      stderr: "xan split: must specify -c or -S\n",
      exitCode: 1,
    };
  }

  const { headers, data, error } = await readCsvInput(fileArgs, ctx);
  if (error) return error;

  // Calculate splits
  const parts: CsvData[] = [];
  if (numParts) {
    const size = Math.ceil(data.length / numParts);
    for (let i = 0; i < numParts; i++) {
      parts.push(data.slice(i * size, (i + 1) * size));
    }
  } else if (partSize) {
    for (let i = 0; i < data.length; i += partSize) {
      parts.push(data.slice(i, i + partSize));
    }
  }

  // Filter out empty parts
  const nonEmptyParts = parts.filter((p) => p.length > 0);

  // In sandbox, we can't write multiple files, so output as concatenated CSV with markers
  // or write to virtual filesystem
  const baseName = fileArgs[0]?.replace(/\.csv$/, "") || "part";

  try {
    const outPath = ctx.fs.resolvePath(ctx.cwd, outputDir);
    for (let i = 0; i < nonEmptyParts.length; i++) {
      const fileName = `${baseName}_${String(i + 1).padStart(3, "0")}.csv`;
      const filePath = ctx.fs.resolvePath(outPath, fileName);
      await ctx.fs.writeFile(filePath, formatCsv(headers, nonEmptyParts[i]));
    }
    return {
      stdout: `Split into ${nonEmptyParts.length} parts\n`,
      stderr: "",
      exitCode: 0,
    };
  } catch {
    // If we can't write files, output info about what would be created
    const output = nonEmptyParts
      .map((p, i) => `Part ${i + 1}: ${p.length} rows`)
      .join("\n");
    return { stdout: `${output}\n`, stderr: "", exitCode: 0 };
  }
}

/**
 * Partition: split CSV by column value into separate outputs
 * Usage: xan partition COLUMN [OPTIONS] [FILE]
 *   -o, --output DIR  Output directory (default: current)
 */
export async function cmdPartition(
  args: string[],
  ctx: CommandContext,
): Promise<ExecResult> {
  let column = "";
  let outputDir = ".";
  const fileArgs: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if ((arg === "-o" || arg === "--output") && i + 1 < args.length) {
      outputDir = args[++i];
    } else if (!arg.startsWith("-")) {
      if (!column) {
        column = arg;
      } else {
        fileArgs.push(arg);
      }
    }
  }

  if (!column) {
    return {
      stdout: "",
      stderr: "xan partition: usage: xan partition COLUMN [FILE]\n",
      exitCode: 1,
    };
  }

  const { headers, data, error } = await readCsvInput(fileArgs, ctx);
  if (error) return error;

  if (!headers.includes(column)) {
    return {
      stdout: "",
      stderr: `xan partition: column '${column}' not found\n`,
      exitCode: 1,
    };
  }

  // Group by column value
  const groups = new Map<string, CsvData>();
  for (const row of data) {
    const val = String(row[column] ?? "");
    if (!groups.has(val)) {
      groups.set(val, []);
    }
    groups.get(val)?.push(row);
  }

  // Write files
  try {
    const outPath = ctx.fs.resolvePath(ctx.cwd, outputDir);
    for (const [val, rows] of groups) {
      const safeVal = val.replace(/[^a-zA-Z0-9_-]/g, "_") || "empty";
      const fileName = `${safeVal}.csv`;
      const filePath = ctx.fs.resolvePath(outPath, fileName);
      await ctx.fs.writeFile(filePath, formatCsv(headers, rows));
    }
    return {
      stdout: `Partitioned into ${groups.size} files by '${column}'\n`,
      stderr: "",
      exitCode: 0,
    };
  } catch {
    // Output summary if can't write
    const output = Array.from(groups.entries())
      .map(([val, rows]) => `${val}: ${rows.length} rows`)
      .join("\n");
    return { stdout: `${output}\n`, stderr: "", exitCode: 0 };
  }
}

/**
 * To: convert CSV to other formats
 * Usage: xan to FORMAT [OPTIONS] [FILE]
 *   FORMAT: json
 */
export async function cmdTo(
  args: string[],
  ctx: CommandContext,
): Promise<ExecResult> {
  if (args.length === 0) {
    return {
      stdout: "",
      stderr: "xan to: usage: xan to <format> [FILE]\n",
      exitCode: 1,
    };
  }

  const format = args[0];
  const subArgs = args.slice(1);

  if (format === "json") {
    return cmdToJson(subArgs, ctx);
  }

  return {
    stdout: "",
    stderr: `xan to: unsupported format '${format}'\n`,
    exitCode: 1,
  };
}

/**
 * To JSON: convert CSV to JSON
 * Usage: xan to json [FILE]
 */
async function cmdToJson(
  args: string[],
  ctx: CommandContext,
): Promise<ExecResult> {
  const fileArgs = args.filter((a) => !a.startsWith("-"));

  const { data, error } = await readCsvInput(fileArgs, ctx);
  if (error) return error;

  // Real xan always pretty prints
  const json = JSON.stringify(data, null, 2);
  return { stdout: `${json}\n`, stderr: "", exitCode: 0 };
}

/**
 * From: convert other formats to CSV
 * Usage: xan from [OPTIONS] [FILE]
 *   -f, --format FORMAT   Input format (json)
 */
export async function cmdFrom(
  args: string[],
  ctx: CommandContext,
): Promise<ExecResult> {
  let format = "";
  const fileArgs: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if ((arg === "-f" || arg === "--format") && i + 1 < args.length) {
      format = args[++i];
    } else if (!arg.startsWith("-")) {
      fileArgs.push(arg);
    }
  }

  if (!format) {
    return {
      stdout: "",
      stderr: "xan from: usage: xan from -f <format> [FILE]\n",
      exitCode: 1,
    };
  }

  if (format === "json") {
    return cmdFromJson(fileArgs, ctx);
  }

  return {
    stdout: "",
    stderr: `xan from: unsupported format '${format}'\n`,
    exitCode: 1,
  };
}

/**
 * From JSON: convert JSON to CSV
 * Usage: xan from -f json [FILE]
 */
async function cmdFromJson(
  fileArgs: string[],
  ctx: CommandContext,
): Promise<ExecResult> {
  const file = fileArgs[0];
  let input: string;

  if (!file || file === "-") {
    input = ctx.stdin;
  } else {
    try {
      const path = ctx.fs.resolvePath(ctx.cwd, file);
      input = await ctx.fs.readFile(path);
    } catch {
      return {
        stdout: "",
        stderr: `xan from: ${file}: No such file or directory\n`,
        exitCode: 1,
      };
    }
  }

  try {
    const data = JSON.parse(input.trim());
    if (!Array.isArray(data)) {
      return {
        stdout: "",
        stderr: "xan from: JSON input must be an array\n",
        exitCode: 1,
      };
    }

    if (data.length === 0) {
      return { stdout: "\n", stderr: "", exitCode: 0 };
    }

    // Check if array of arrays or array of objects
    if (Array.isArray(data[0])) {
      // Array of arrays - first row is headers
      const [headers, ...rows] = data as unknown[][];
      const csvData: CsvData = rows.map((row) => {
        const obj: CsvRow = createSafeRow();
        for (let i = 0; i < (headers as string[]).length; i++) {
          safeSetRow(
            obj,
            (headers as string[])[i],
            row[i] as string | number | boolean | null,
          );
        }
        return obj;
      });
      return {
        stdout: formatCsv(headers as string[], csvData),
        stderr: "",
        exitCode: 0,
      };
    }

    // Array of objects - real xan outputs columns in alphabetical order
    const headers = Object.keys(data[0] as object).sort();
    return {
      stdout: formatCsv(headers, data as CsvData),
      stderr: "",
      exitCode: 0,
    };
  } catch {
    return {
      stdout: "",
      stderr: "xan from: invalid JSON input\n",
      exitCode: 1,
    };
  }
}
