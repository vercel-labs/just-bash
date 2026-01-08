/**
 * Filter and sort commands: filter, sort, dedup, top
 */

import type { CommandContext, ExecResult } from "../../types.js";
import { showHelp } from "../help.js";
import { type EvaluateOptions, evaluate } from "../query-engine/index.js";
import { type CsvData, formatCsv, readCsvInput } from "./csv.js";
import { parseMoonbladeExpr } from "./xan-utils.js";

export async function cmdFilter(
  args: string[],
  ctx: CommandContext,
): Promise<ExecResult> {
  let invert = false;
  let limit = 0; // 0 means no limit
  let expr = "";
  const fileArgs: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-v" || arg === "--invert") {
      invert = true;
    } else if ((arg === "-l" || arg === "--limit") && i + 1 < args.length) {
      limit = Number.parseInt(args[++i], 10);
    } else if (arg === "--help") {
      return showHelp({
        name: "xan filter",
        summary: "Filter rows by expression",
        usage: "xan filter [OPTIONS] EXPR [FILE]",
        description: "Filter CSV rows using moonblade expressions.",
        options: [
          "-v, --invert    invert match",
          "-l, --limit N   limit output to N rows",
          "    --help      display help",
        ],
      });
    } else if (!arg.startsWith("-")) {
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
      stderr: "xan filter: no expression specified\n",
      exitCode: 1,
    };
  }

  const { headers, data, error } = await readCsvInput(fileArgs, ctx);
  if (error) return error;

  const evalOptions: EvaluateOptions = {
    limits: ctx.limits
      ? { maxIterations: ctx.limits.maxJqIterations }
      : undefined,
  };

  const ast = parseMoonbladeExpr(expr);
  const filtered: CsvData = [];
  for (const row of data) {
    if (limit > 0 && filtered.length >= limit) break;
    const results = evaluate(row, ast, evalOptions);
    const matches = results.length > 0 && results.some((r) => !!r);
    if (invert ? !matches : matches) {
      filtered.push(row);
    }
  }

  return { stdout: formatCsv(headers, filtered), stderr: "", exitCode: 0 };
}

export async function cmdSort(
  args: string[],
  ctx: CommandContext,
): Promise<ExecResult> {
  let column = "";
  let numeric = false;
  let reverse = false;
  const fileArgs: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-N" || arg === "--numeric") {
      numeric = true;
    } else if (arg === "-R" || arg === "-r" || arg === "--reverse") {
      reverse = true;
    } else if (arg === "-s" && i + 1 < args.length) {
      // -s is followed by column name
      column = args[++i];
    } else if (!arg.startsWith("-")) {
      fileArgs.push(arg);
    }
  }

  const { headers, data, error } = await readCsvInput(fileArgs, ctx);
  if (error) return error;

  // Default to first column if not specified
  if (!column && headers.length > 0) {
    column = headers[0];
  }

  const sorted = [...data].sort((a, b) => {
    const va = a[column];
    const vb = b[column];
    let cmp: number;

    if (numeric) {
      const na = typeof va === "number" ? va : Number.parseFloat(String(va));
      const nb = typeof vb === "number" ? vb : Number.parseFloat(String(vb));
      cmp = na - nb;
    } else {
      cmp = String(va).localeCompare(String(vb));
    }

    return reverse ? -cmp : cmp;
  });

  return { stdout: formatCsv(headers, sorted), stderr: "", exitCode: 0 };
}

export async function cmdDedup(
  args: string[],
  ctx: CommandContext,
): Promise<ExecResult> {
  let column = "";
  const fileArgs: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-s" && i + 1 < args.length) {
      column = args[++i];
    } else if (!arg.startsWith("-")) {
      fileArgs.push(arg);
    }
  }

  const { headers, data, error } = await readCsvInput(fileArgs, ctx);
  if (error) return error;

  const seen = new Set<string>();
  const deduped = data.filter((row) => {
    const key = column ? String(row[column]) : JSON.stringify(row);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { stdout: formatCsv(headers, deduped), stderr: "", exitCode: 0 };
}

export async function cmdTop(
  args: string[],
  ctx: CommandContext,
): Promise<ExecResult> {
  let n = 10;
  let column = "";
  let reverse = false;
  const fileArgs: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if ((arg === "-l" || arg === "-n") && i + 1 < args.length) {
      n = Number.parseInt(args[++i], 10);
    } else if (arg === "-R" || arg === "-r" || arg === "--reverse") {
      reverse = true;
    } else if (!arg.startsWith("-")) {
      // First non-flag arg is column, rest are files
      if (!column) {
        column = arg;
      } else {
        fileArgs.push(arg);
      }
    }
  }

  const { headers, data, error } = await readCsvInput(fileArgs, ctx);
  if (error) return error;

  if (!column && headers.length > 0) {
    column = headers[0];
  }

  const sorted = [...data].sort((a, b) => {
    const va = a[column];
    const vb = b[column];

    const na = typeof va === "number" ? va : Number.parseFloat(String(va));
    const nb = typeof vb === "number" ? vb : Number.parseFloat(String(vb));

    // reverse=false means top (descending), reverse=true means bottom (ascending)
    return reverse ? na - nb : nb - na;
  });

  const rows = sorted.slice(0, n);
  return { stdout: formatCsv(headers, rows), stderr: "", exitCode: 0 };
}
