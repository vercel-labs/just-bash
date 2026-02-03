/**
 * Simple commands: behead, sample, cat, search, flatmap, fmt
 */

import type { CommandContext, ExecResult } from "../../types.js";
import { readFiles } from "../../utils/file-reader.js";
import { type EvaluateOptions, evaluate } from "../query-engine/index.js";
import {
  type CsvData,
  type CsvRow,
  createSafeRow,
  formatCsv,
  parseCsv,
  readCsvInput,
  safeSetRow,
  toSafeRow,
} from "./csv.js";
import { parseNamedExpressions } from "./moonblade-parser.js";
import { moonbladeToJq } from "./moonblade-to-jq.js";

/**
 * Behead: remove header row from CSV (output data rows only)
 * Usage: xan behead [FILE]
 */
export async function cmdBehead(
  args: string[],
  ctx: CommandContext,
): Promise<ExecResult> {
  const fileArgs = args.filter((a) => !a.startsWith("-"));

  const { headers, data, error } = await readCsvInput(fileArgs, ctx);
  if (error) return error;

  // Output data rows only (no header)
  if (data.length === 0) {
    return { stdout: "", stderr: "", exitCode: 0 };
  }

  const rows = data.map((row) => headers.map((h) => row[h]));
  const output =
    rows.map((row) => row.map((v) => formatValue(v)).join(",")).join("\n") +
    "\n";

  return { stdout: output, stderr: "", exitCode: 0 };
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Sample: randomly sample N rows from CSV
 * Usage: xan sample [OPTIONS] <sample-size> [FILE]
 *   --seed SEED    Random seed for reproducibility
 */
export async function cmdSample(
  args: string[],
  ctx: CommandContext,
): Promise<ExecResult> {
  let num: number | null = null;
  let seed: number | null = null;
  const fileArgs: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--seed" && i + 1 < args.length) {
      seed = Number.parseInt(args[++i], 10);
    } else if (!arg.startsWith("-")) {
      // First positional arg is sample size, rest are files
      const parsed = Number.parseInt(arg, 10);
      if (num === null && !Number.isNaN(parsed) && parsed > 0) {
        num = parsed;
      } else {
        fileArgs.push(arg);
      }
    }
  }

  if (num === null) {
    return {
      stdout: "",
      stderr: "xan sample: usage: xan sample <sample-size> [FILE]\n",
      exitCode: 1,
    };
  }

  const { headers, data, error } = await readCsvInput(fileArgs, ctx);
  if (error) return error;

  if (data.length <= num) {
    return { stdout: formatCsv(headers, data), stderr: "", exitCode: 0 };
  }

  // Simple seeded random (LCG)
  let rng = seed !== null ? seed : Date.now();
  const random = () => {
    rng = (rng * 1103515245 + 12345) & 0x7fffffff;
    return rng / 0x7fffffff;
  };

  // Fisher-Yates shuffle, take first N
  const indices = data.map((_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }

  const sampled = indices
    .slice(0, num)
    .sort((a, b) => a - b)
    .map((i) => data[i]);

  return { stdout: formatCsv(headers, sampled), stderr: "", exitCode: 0 };
}

/**
 * Cat: concatenate CSV files
 * Usage: xan cat [OPTIONS] FILE1 FILE2 ...
 *   -p, --pad    Pad missing columns with empty values
 */
export async function cmdCat(
  args: string[],
  ctx: CommandContext,
): Promise<ExecResult> {
  let pad = false;
  const fileArgs: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-p" || arg === "--pad") {
      pad = true;
    } else if (!arg.startsWith("-")) {
      fileArgs.push(arg);
    }
  }

  if (fileArgs.length === 0) {
    return {
      stdout: "",
      stderr: "xan cat: no files specified\n",
      exitCode: 1,
    };
  }

  // Read all files in parallel
  const result = await readFiles(ctx, fileArgs, {
    cmdName: "xan cat",
    stopOnError: true,
  });
  if (result.exitCode !== 0) {
    return { stdout: "", stderr: result.stderr, exitCode: result.exitCode };
  }

  // Parse CSVs and collect headers
  const allFiles: { headers: string[]; data: CsvData }[] = [];
  let allHeaders: string[] = [];

  for (const { content } of result.files) {
    const { headers, data } = parseCsv(content);
    allFiles.push({ headers, data });

    // Collect all unique headers
    for (const h of headers) {
      if (!allHeaders.includes(h)) {
        allHeaders.push(h);
      }
    }
  }

  // Check headers match (unless padding)
  if (!pad) {
    const firstHeaders = JSON.stringify(allFiles[0].headers);
    for (let i = 1; i < allFiles.length; i++) {
      if (JSON.stringify(allFiles[i].headers) !== firstHeaders) {
        return {
          stdout: "",
          stderr: "xan cat: headers do not match (use -p to pad)\n",
          exitCode: 1,
        };
      }
    }
    allHeaders = allFiles[0].headers;
  }

  // Concatenate data
  const allData: CsvData = [];
  for (const { headers, data } of allFiles) {
    for (const row of data) {
      const newRow: CsvRow = createSafeRow();
      for (const h of allHeaders) {
        safeSetRow(newRow, h, headers.includes(h) ? row[h] : "");
      }
      allData.push(newRow);
    }
  }

  return { stdout: formatCsv(allHeaders, allData), stderr: "", exitCode: 0 };
}

/**
 * Search: filter rows by regex match on any/specific columns
 * Usage: xan search [OPTIONS] PATTERN [FILE]
 *   -s, --select COLS    Only search in these columns
 *   -v, --invert         Invert match (exclude matching rows)
 *   -i, --ignore-case    Case insensitive match
 */
export async function cmdSearch(
  args: string[],
  ctx: CommandContext,
): Promise<ExecResult> {
  let pattern = "";
  let selectCols: string[] = [];
  let invert = false;
  let ignoreCase = false;
  const fileArgs: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if ((arg === "-s" || arg === "--select") && i + 1 < args.length) {
      selectCols = args[++i].split(",");
    } else if (arg === "-v" || arg === "--invert") {
      invert = true;
    } else if (arg === "-i" || arg === "--ignore-case") {
      ignoreCase = true;
    } else if (arg === "-r" || arg === "--regex") {
      // -r is implied, just skip
    } else if (!arg.startsWith("-")) {
      if (!pattern) {
        pattern = arg;
      } else {
        fileArgs.push(arg);
      }
    }
  }

  if (!pattern) {
    return {
      stdout: "",
      stderr: "xan search: no pattern specified\n",
      exitCode: 1,
    };
  }

  const { headers, data, error } = await readCsvInput(fileArgs, ctx);
  if (error) return error;

  const searchCols = selectCols.length > 0 ? selectCols : headers;

  let regex: RegExp;
  try {
    regex = new RegExp(pattern, ignoreCase ? "i" : "");
  } catch {
    return {
      stdout: "",
      stderr: `xan search: invalid regex pattern '${pattern}'\n`,
      exitCode: 1,
    };
  }

  const filtered = data.filter((row) => {
    const matches = searchCols.some((col) => {
      const val = row[col];
      return val !== null && val !== undefined && regex.test(String(val));
    });
    return invert ? !matches : matches;
  });

  return { stdout: formatCsv(headers, filtered), stderr: "", exitCode: 0 };
}

/**
 * Flatmap: like map but expression can return multiple rows
 * Usage: xan flatmap EXPR [FILE]
 *   The expression should return an array; each element becomes a row
 */
export async function cmdFlatmap(
  args: string[],
  ctx: CommandContext,
): Promise<ExecResult> {
  let expr = "";
  const fileArgs: string[] = [];

  for (const arg of args) {
    if (!arg.startsWith("-")) {
      if (!expr) {
        expr = arg;
      } else {
        fileArgs.push(arg);
      }
    }
  }

  if (!expr) {
    return {
      stdout: "",
      stderr: "xan flatmap: no expression specified\n",
      exitCode: 1,
    };
  }

  const { headers, data, error } = await readCsvInput(fileArgs, ctx);
  if (error) return error;

  // Parse expression
  const namedExprs = parseNamedExpressions(expr);
  const specs = namedExprs.map(({ expr: e, name }) => ({
    alias: typeof name === "string" ? name : name[0],
    ast: moonbladeToJq(e),
  }));

  const evalOptions: EvaluateOptions = {
    limits: ctx.limits
      ? { maxIterations: ctx.limits.maxJqIterations }
      : undefined,
  };

  // New headers include mapped columns
  const newHeaders = [...headers, ...specs.map((s) => s.alias)];
  const newData: CsvData = [];

  for (const row of data) {
    // Evaluate each spec
    const results: unknown[][] = [];
    let maxLen = 1;

    for (const spec of specs) {
      const evalResults = evaluate(row, spec.ast, evalOptions);
      // If result is array, expand it
      const expanded =
        evalResults.length > 0 && Array.isArray(evalResults[0])
          ? evalResults[0]
          : evalResults;
      results.push(expanded as unknown[]);
      maxLen = Math.max(maxLen, expanded.length);
    }

    // Create rows for each result
    for (let i = 0; i < maxLen; i++) {
      const newRow: CsvRow = toSafeRow(row);
      for (let j = 0; j < specs.length; j++) {
        const val = results[j][i] ?? null;
        safeSetRow(
          newRow,
          specs[j].alias,
          val as string | number | boolean | null,
        );
      }
      newData.push(newRow);
    }
  }

  return { stdout: formatCsv(newHeaders, newData), stderr: "", exitCode: 0 };
}

/**
 * Fmt: format CSV as a table (alias for view with options)
 * Usage: xan fmt [OPTIONS] [FILE]
 */
export async function cmdFmt(
  args: string[],
  ctx: CommandContext,
): Promise<ExecResult> {
  // Fmt is essentially an alias for view
  const { cmdView } = await import("./xan-view.js");
  return cmdView(args, ctx);
}
