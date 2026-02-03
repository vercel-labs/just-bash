/**
 * Map command: add computed columns
 */

import type { CommandContext, ExecResult } from "../../types.js";
import { type EvaluateOptions, evaluate } from "../query-engine/index.js";
import {
  type CsvData,
  type CsvRow,
  formatCsv,
  readCsvInput,
  safeSetRow,
  toSafeRow,
} from "./csv.js";
import { parseNamedExpressions } from "./moonblade-parser.js";
import { moonbladeToJq } from "./moonblade-to-jq.js";

export async function cmdMap(
  args: string[],
  ctx: CommandContext,
): Promise<ExecResult> {
  let mapExpr = "";
  let overwrite = false;
  let filter = false;
  const fileArgs: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-O" || arg === "--overwrite") {
      overwrite = true;
    } else if (arg === "--filter") {
      filter = true;
    } else if (!arg.startsWith("-")) {
      if (!mapExpr) {
        mapExpr = arg;
      } else {
        fileArgs.push(arg);
      }
    }
  }

  if (!mapExpr) {
    return {
      stdout: "",
      stderr: "xan map: no expression specified\n",
      exitCode: 1,
    };
  }

  const { headers, data, error } = await readCsvInput(fileArgs, ctx);
  if (error) return error;

  // Parse moonblade expressions
  const namedExprs = parseNamedExpressions(mapExpr);
  const specs = namedExprs.map(({ expr, name }) => ({
    alias: typeof name === "string" ? name : name[0],
    ast: moonbladeToJq(expr),
  }));

  const evalOptions: EvaluateOptions = {
    limits: ctx.limits
      ? { maxIterations: ctx.limits.maxJqIterations }
      : undefined,
  };

  // Build new headers
  let newHeaders: string[];
  if (overwrite) {
    // Replace existing columns with same name
    newHeaders = [...headers];
    for (const spec of specs) {
      if (!headers.includes(spec.alias)) {
        newHeaders.push(spec.alias);
      }
    }
  } else {
    newHeaders = [...headers, ...specs.map((s) => s.alias)];
  }

  const newData: CsvData = [];
  for (let rowIndex = 0; rowIndex < data.length; rowIndex++) {
    const row = data[rowIndex];
    const newRow: CsvRow = toSafeRow(row);
    let skip = false;

    // Add row index for index() function
    const rowWithIndex = { ...row, _row_index: rowIndex };

    for (const spec of specs) {
      const results = evaluate(rowWithIndex, spec.ast, evalOptions);
      const value = results.length > 0 ? results[0] : null;

      // If filtering and value is null/undefined, skip row
      if (filter && (value === null || value === undefined)) {
        skip = true;
        break;
      }

      safeSetRow(newRow, spec.alias, value as string | number | boolean | null);
    }

    if (!skip) {
      newData.push(newRow);
    }
  }

  return { stdout: formatCsv(newHeaders, newData), stderr: "", exitCode: 0 };
}

/**
 * Transform command: modify existing columns in-place
 * Usage: xan transform COLUMN EXPR [FILE]
 *   -r, --rename NAME  Rename the column after transformation
 */
export async function cmdTransform(
  args: string[],
  ctx: CommandContext,
): Promise<ExecResult> {
  let targetCol = "";
  let transformExpr = "";
  let rename = "";
  const fileArgs: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if ((arg === "-r" || arg === "--rename") && i + 1 < args.length) {
      rename = args[++i];
    } else if (!arg.startsWith("-")) {
      if (!targetCol) {
        targetCol = arg;
      } else if (!transformExpr) {
        transformExpr = arg;
      } else {
        fileArgs.push(arg);
      }
    }
  }

  if (!targetCol || !transformExpr) {
    return {
      stdout: "",
      stderr: "xan transform: usage: xan transform COLUMN EXPR [FILE]\n",
      exitCode: 1,
    };
  }

  const { headers, data, error } = await readCsvInput(fileArgs, ctx);
  if (error) return error;

  // Handle multiple columns (comma-separated)
  const targetCols = targetCol.split(",").map((c) => c.trim());
  const renameCols = rename ? rename.split(",").map((c) => c.trim()) : [];

  // Validate columns exist
  for (const col of targetCols) {
    if (!headers.includes(col)) {
      return {
        stdout: "",
        stderr: `xan transform: column '${col}' not found\n`,
        exitCode: 1,
      };
    }
  }

  // Parse the expression
  const ast = moonbladeToJq(
    parseNamedExpressions(transformExpr)[0]?.expr ||
      require("./moonblade-parser.js").parseMoonblade(transformExpr),
  );

  const evalOptions: EvaluateOptions = {
    limits: ctx.limits
      ? { maxIterations: ctx.limits.maxJqIterations }
      : undefined,
  };

  // Build new headers (rename if specified)
  const newHeaders = headers.map((h) => {
    const idx = targetCols.indexOf(h);
    if (idx !== -1 && renameCols[idx]) {
      return renameCols[idx];
    }
    return h;
  });

  const newData: CsvData = [];
  for (const row of data) {
    const newRow: CsvRow = toSafeRow(row);

    for (let i = 0; i < targetCols.length; i++) {
      const col = targetCols[i];
      // For implicit expressions like "upper", wrap in function call
      // The _ variable represents the current column value
      const rowWithUnderscore = { ...row, _: row[col] };
      const results = evaluate(rowWithUnderscore, ast, evalOptions);
      const value = results.length > 0 ? results[0] : null;

      // Update the column (use new name if renamed)
      const newColName = renameCols[i] || col;
      if (newColName !== col) {
        delete newRow[col];
      }
      safeSetRow(newRow, newColName, value as string | number | boolean | null);
    }

    newData.push(newRow);
  }

  return { stdout: formatCsv(newHeaders, newData), stderr: "", exitCode: 0 };
}
