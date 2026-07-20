/**
 * Data utility commands: transpose, shuffle, fixlengths, split, partition
 * Commands that exist in real xan
 */

import { BoundedStringBuilder } from "../../bounded-builder.js";
import { decodeBytesToUtf8, utf8ByteLength } from "../../encoding.js";
import { rethrowFatalExecutionError } from "../../fatal-execution-error.js";
import { ExecutionLimitError } from "../../interpreter/errors.js";
import type { CommandContext, ExecResult } from "../../types.js";
import { formatJsonValue } from "../query-engine/json-output.js";
import { sanitizeParsedData } from "../query-engine/safe-object.js";
import type { QueryValue } from "../query-engine/value-operations.js";
import {
  type CsvData,
  type CsvRow,
  createSafeRow,
  DerivedCsvBudget,
  formatCsv,
  formatCsvRows,
  parseCsvRows,
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
    // xan emits text; the pipeline handles encoding.
    return {
      stdout: formatCsv(newHeaders, newData, ctx),
      stderr: "",
      exitCode: 0,
    };
  }

  // New headers: first column name + row indices or first column values
  const firstCol = headers[0];
  const newHeaders = [
    firstCol,
    ...data.map((row, i) => String(row[firstCol] ?? `row_${i}`)),
  ];
  if (new Set(newHeaders).size !== newHeaders.length) {
    return {
      stdout: "",
      stderr: "xan transpose: duplicate output headers\n",
      exitCode: 1,
    };
  }

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

  // xan emits text; the pipeline handles encoding.
  return {
    stdout: formatCsv(newHeaders, newData, ctx),
    stderr: "",
    exitCode: 0,
  };
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

  // xan emits text; the pipeline handles encoding.
  return {
    stdout: formatCsv(headers, shuffled, ctx),
    stderr: "",
    exitCode: 0,
  };
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
      const rawLength = args[++i];
      if (!/^[1-9]\d*$/.test(rawLength)) {
        return {
          stdout: "",
          stderr: "xan fixlengths: length must be a positive safe integer\n",
          exitCode: 1,
        };
      }
      targetLen = Number(rawLength);
      if (
        !Number.isSafeInteger(targetLen) ||
        targetLen > ctx.limits.maxArrayElements
      ) {
        throw new ExecutionLimitError(
          `xan fixlengths: column limit exceeded (${ctx.limits.maxArrayElements})`,
          "array_elements",
        );
      }
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
    input = decodeBytesToUtf8(ctx.stdin);
  } else {
    try {
      const path = ctx.fs.resolvePath(ctx.cwd, file);
      input = await ctx.fs.readFile(path);
    } catch (error) {
      rethrowFatalExecutionError(error);
      return {
        stdout: "",
        stderr: `xan fixlengths: ${file}: No such file or directory\n`,
        exitCode: 1,
      };
    }
  }

  const rows = parseCsvRows(input, {
    maxStringLength: Math.min(
      ctx.limits.maxInputBytes,
      ctx.limits.maxStringLength,
    ),
    maxArrayElements: ctx.limits.maxArrayElements,
    maxRows: ctx.limits.maxCsvRows,
    maxCells: ctx.limits.maxCsvCells,
  });

  if (rows.length === 0) {
    return { stdout: "", stderr: "", exitCode: 0 };
  }

  // Determine target length
  let maxLen = 0;
  for (const row of rows) maxLen = Math.max(maxLen, row.length);
  const len = targetLen ?? maxLen;
  const budget = new DerivedCsvBudget(ctx, "xan fixlengths");
  budget.addRows(rows.length, len);

  // Fix each row
  for (const row of rows) {
    if (row.length > len) row.length = len;
    while (row.length < len) row.push(defaultValue);
  }

  // xan emits text; the pipeline handles encoding.
  return {
    stdout: formatCsvRows(rows, ctx),
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

  const parsePositiveInteger = (value: string): number | null => {
    if (!/^[1-9]\d*$/.test(value)) return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if ((arg === "-c" || arg === "--chunks") && i + 1 < args.length) {
      numParts = parsePositiveInteger(args[++i]);
      if (numParts === null) {
        return {
          stdout: "",
          stderr: "xan split: chunk count must be a positive safe integer\n",
          exitCode: 1,
        };
      }
    } else if ((arg === "-S" || arg === "--size") && i + 1 < args.length) {
      partSize = parsePositiveInteger(args[++i]);
      if (partSize === null) {
        return {
          stdout: "",
          stderr: "xan split: chunk size must be a positive safe integer\n",
          exitCode: 1,
        };
      }
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

  const chunkSize = numParts
    ? Math.ceil(data.length / numParts)
    : (partSize as number);
  const partCount = chunkSize === 0 ? 0 : Math.ceil(data.length / chunkSize);
  if (partCount > ctx.limits.maxArrayElements) {
    throw new ExecutionLimitError(
      `xan split: output part limit exceeded (${ctx.limits.maxArrayElements})`,
      "array_elements",
    );
  }

  // In sandbox, we can't write multiple files, so output as concatenated CSV with markers
  // or write to virtual filesystem
  const baseName = fileArgs[0]?.replace(/\.csv$/, "") || "part";

  try {
    const outPath = ctx.fs.resolvePath(ctx.cwd, outputDir);
    for (let i = 0; i < partCount; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, data.length);
      ctx.executionScope?.consumeWork(end - start, "xan split rows");
      const fileName = `${baseName}_${String(i + 1).padStart(3, "0")}.csv`;
      const filePath = ctx.fs.resolvePath(outPath, fileName);
      await ctx.fs.writeFile(
        filePath,
        formatCsv(headers, data.slice(start, end), ctx),
      );
    }
    // xan emits text; the pipeline handles encoding.
    return {
      stdout: `Split into ${partCount} parts\n`,
      stderr: "",
      exitCode: 0,
    };
  } catch (error) {
    rethrowFatalExecutionError(error);
    // If we can't write files, output info about what would be created
    const output = new BoundedStringBuilder(
      ctx.limits.maxOutputSize,
      "xan split",
    );
    for (let i = 0; i < partCount; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, data.length);
      output.append(`Part ${i + 1}: ${end - start} rows\n`);
    }
    // xan emits text; the pipeline handles encoding.
    return {
      stdout: output.build(),
      stderr: "",
      exitCode: 0,
    };
  }
}

function sanitizeForFilename(val: string): string {
  return val.replace(/[^a-zA-Z0-9_-]/g, "_") || "empty";
}

// FNV-1a 32-bit hash, base36, 6 chars. Deterministic and short — used
// only to disambiguate filenames when distinct partition values
// sanitize to the same name (e.g. `a/b` and `a:b` → `a_b`).
function shortHash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h = ((h ^ s.charCodeAt(i)) * 16777619) >>> 0;
  }
  return h.toString(36).padStart(6, "0").slice(0, 6);
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
  const budget = new DerivedCsvBudget(ctx, "xan partition");
  for (const row of data) {
    budget.addRow(headers.length);
    const val = String(row[column] ?? "");
    if (!groups.has(val)) {
      groups.set(val, []);
    }
    groups.get(val)?.push(row);
  }

  // Write files. Sanitization replaces every non-[A-Za-z0-9_-] character
  // with `_`, so distinct values like `a/b`, `a:b`, `a b` all sanitize to
  // `a_b`. Without disambiguation the second group silently overwrites
  // the first — a data-loss bug. We resolve filenames via a single
  // allocator that tracks every name actually emitted, so a collision
  // between a hash-suffixed colliding name and an unsuffixed non-
  // colliding name (e.g. value `a/b` hashes to `a_b_g8wk3l` while the
  // literal value `a_b_g8wk3l` would also produce `a_b_g8wk3l.csv`)
  // is broken with an additional `_1`, `_2`, … counter rather than
  // letting one partition silently overwrite another.
  const sanitizedCounts = new Map<string, number>();
  for (const val of groups.keys()) {
    const safe = sanitizeForFilename(val);
    sanitizedCounts.set(safe, (sanitizedCounts.get(safe) ?? 0) + 1);
  }
  const allocatedNames = new Set<string>();
  const finalName = new Map<string, string>();
  for (const val of groups.keys()) {
    const safe = sanitizeForFilename(val);
    const colliding = (sanitizedCounts.get(safe) ?? 0) > 1;
    const base = colliding ? `${safe}_${shortHash(val)}` : safe;
    let candidate = `${base}.csv`;
    let n = 1;
    while (allocatedNames.has(candidate)) {
      candidate = `${base}_${n}.csv`;
      n++;
    }
    allocatedNames.add(candidate);
    finalName.set(val, candidate);
  }

  try {
    const outPath = ctx.fs.resolvePath(ctx.cwd, outputDir);
    for (const [val, rows] of groups) {
      const fileName = finalName.get(val);
      if (!fileName) continue;
      const filePath = ctx.fs.resolvePath(outPath, fileName);
      await ctx.fs.writeFile(filePath, formatCsv(headers, rows, ctx));
    }
    // xan emits text; the pipeline handles encoding.
    return {
      stdout: `Partitioned into ${groups.size} files by '${column}'\n`,
      stderr: "",
      exitCode: 0,
    };
  } catch (error) {
    rethrowFatalExecutionError(error);
    // Output summary if can't write
    const output = new BoundedStringBuilder(
      ctx.limits.maxOutputSize,
      "xan partition",
    );
    for (const [val, rows] of groups) {
      output.append(`${val}: ${rows.length} rows\n`);
    }
    // xan emits text; the pipeline handles encoding.
    return {
      stdout: output.build(),
      stderr: "",
      exitCode: 0,
    };
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

  const budget = new DerivedCsvBudget(ctx, "xan to json");
  budget.addRows(
    data.length,
    data.length > 0 ? Object.keys(data[0]).length : 0,
  );
  if (ctx.limits.maxOutputSize < 1) {
    throw new ExecutionLimitError(
      "xan to json: output size limit exceeded (0 bytes)",
      "output_size",
    );
  }
  const maxBytes = ctx.limits.maxOutputSize - 1;
  const output = formatJsonValue(data as QueryValue, maxBytes);
  // xan emits text; the pipeline handles encoding.
  return {
    stdout: `${output}\n`,
    stderr: "",
    exitCode: 0,
  };
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
    input = decodeBytesToUtf8(ctx.stdin);
  } else {
    try {
      const path = ctx.fs.resolvePath(ctx.cwd, file);
      input = await ctx.fs.readFile(path);
    } catch (error) {
      rethrowFatalExecutionError(error);
      return {
        stdout: "",
        stderr: `xan from: ${file}: No such file or directory\n`,
        exitCode: 1,
      };
    }
  }

  try {
    const maxInputBytes = Math.min(
      ctx.limits.maxInputBytes,
      ctx.limits.maxStringLength,
    );
    if (utf8ByteLength(input) > maxInputBytes) {
      throw new ExecutionLimitError(
        `xan from: input size limit exceeded (${maxInputBytes} bytes)`,
        "string_length",
      );
    }
    const data = sanitizeParsedData(JSON.parse(input.trim()), {
      maxDepth: ctx.limits.maxQueryDepth,
      maxElements: ctx.limits.maxQueryElements,
    });
    if (!Array.isArray(data)) {
      return {
        stdout: "",
        stderr: "xan from: JSON input must be an array\n",
        exitCode: 1,
      };
    }

    if (data.length === 0) {
      // xan emits text; the pipeline handles encoding.
      return {
        stdout: "\n",
        stderr: "",
        exitCode: 0,
      };
    }

    // Check if array of arrays or array of objects
    if (Array.isArray(data[0])) {
      // Array of arrays - first row is headers
      const arrays = data as unknown[][];
      const headers = arrays[0];
      if (headers.length > ctx.limits.maxArrayElements) {
        throw new ExecutionLimitError(
          `xan from: column limit exceeded (${ctx.limits.maxArrayElements})`,
          "array_elements",
        );
      }
      const headerNames = headers.map(String);
      const budget = new DerivedCsvBudget(ctx, "xan from json");
      budget.addRows(arrays.length - 1, headerNames.length);
      const csvData: CsvData = [];
      for (let rowIndex = 1; rowIndex < arrays.length; rowIndex++) {
        const row = arrays[rowIndex];
        if (!Array.isArray(row)) {
          return {
            stdout: "",
            stderr: "xan from: JSON rows must all have the same shape\n",
            exitCode: 1,
          };
        }
        const obj: CsvRow = createSafeRow();
        for (let i = 0; i < headerNames.length; i++) {
          safeSetRow(
            obj,
            headerNames[i],
            row[i] as string | number | boolean | null,
          );
        }
        csvData.push(obj);
      }
      // xan emits text; the pipeline handles encoding.
      return {
        stdout: formatCsv(headerNames, csvData, ctx),
        stderr: "",
        exitCode: 0,
      };
    }

    // Array of objects - real xan outputs columns in alphabetical order
    const first = data[0];
    if (!first || typeof first !== "object" || Array.isArray(first)) {
      return {
        stdout: "",
        stderr: "xan from: JSON rows must be arrays or objects\n",
        exitCode: 1,
      };
    }
    const headers = Object.keys(first).sort();
    const budget = new DerivedCsvBudget(ctx, "xan from json");
    budget.addRows(data.length, headers.length);
    for (const row of data) {
      if (!row || typeof row !== "object" || Array.isArray(row)) {
        return {
          stdout: "",
          stderr: "xan from: JSON rows must all have the same shape\n",
          exitCode: 1,
        };
      }
    }
    // xan emits text; the pipeline handles encoding.
    return {
      stdout: formatCsv(headers, data as CsvData, ctx),
      stderr: "",
      exitCode: 0,
    };
  } catch (error) {
    rethrowFatalExecutionError(error);
    return {
      stdout: "",
      stderr: "xan from: invalid JSON input\n",
      exitCode: 1,
    };
  }
}
