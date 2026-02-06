/**
 * Aggregation commands: agg, groupby, frequency, stats
 */

import type { CommandContext, ExecResult } from "../../types.js";
import type { EvaluateOptions } from "../query-engine/index.js";
import { buildAggRow, computeAgg, parseAggExpr } from "./aggregation.js";
import {
  type CsvData,
  type CsvRow,
  createSafeRow,
  formatCsv,
  readCsvInput,
  safeSetRow,
} from "./csv.js";

export async function cmdAgg(
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
      stderr: "xan agg: no aggregation expression\n",
      exitCode: 1,
    };
  }

  const { data, error } = await readCsvInput(fileArgs, ctx);
  if (error) return error;

  const evalOptions: EvaluateOptions = {
    limits: ctx.limits
      ? { maxIterations: ctx.limits.maxJqIterations }
      : undefined,
  };

  const specs = parseAggExpr(expr);
  const headers = specs.map((s) => s.alias);
  const row = buildAggRow(data, specs, evalOptions);

  return { stdout: formatCsv(headers, [row]), stderr: "", exitCode: 0 };
}

export async function cmdGroupby(
  args: string[],
  ctx: CommandContext,
): Promise<ExecResult> {
  let groupCols = "";
  let aggExpr = "";
  const fileArgs: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--sorted") {
      // --sorted flag is accepted but currently a no-op (insertion order preserved)
    } else if (!arg.startsWith("-")) {
      if (!groupCols) {
        groupCols = arg;
      } else if (!aggExpr) {
        aggExpr = arg;
      } else {
        fileArgs.push(arg);
      }
    }
  }

  if (!groupCols || !aggExpr) {
    return {
      stdout: "",
      stderr: "xan groupby: usage: xan groupby COLS EXPR [FILE]\n",
      exitCode: 1,
    };
  }

  const { data, error } = await readCsvInput(fileArgs, ctx);
  if (error) return error;

  const evalOptions: EvaluateOptions = {
    limits: ctx.limits
      ? { maxIterations: ctx.limits.maxJqIterations }
      : undefined,
  };

  const groupKeys = groupCols.split(",");
  const specs = parseAggExpr(aggExpr);

  // Group rows by key - use array to preserve first-seen order
  const groupOrder: string[] = [];
  const groups = new Map<string, CsvData>();
  for (const row of data) {
    const key = groupKeys.map((k) => String(row[k])).join("\0");
    if (!groups.has(key)) {
      groups.set(key, []);
      groupOrder.push(key);
    }
    groups.get(key)?.push(row);
  }

  // Compute aggregates for each group
  const headers = [...groupKeys, ...specs.map((s) => s.alias)];
  const results: CsvData = [];

  for (const key of groupOrder) {
    const groupData = groups.get(key);
    if (!groupData) continue;
    const row: CsvRow = createSafeRow();
    // Copy group key values
    for (const k of groupKeys) {
      safeSetRow(row, k, groupData[0][k]);
    }
    // Compute aggregates
    for (const spec of specs) {
      safeSetRow(row, spec.alias, computeAgg(groupData, spec, evalOptions));
    }
    results.push(row);
  }

  return { stdout: formatCsv(headers, results), stderr: "", exitCode: 0 };
}

export async function cmdFrequency(
  args: string[],
  ctx: CommandContext,
): Promise<ExecResult> {
  let selectCols: string[] = [];
  let groupCol = "";
  let limit = 10; // default limit
  let noExtra = false;
  const fileArgs: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if ((arg === "-s" || arg === "--select") && i + 1 < args.length) {
      selectCols = args[++i].split(",");
    } else if ((arg === "-g" || arg === "--groupby") && i + 1 < args.length) {
      groupCol = args[++i];
    } else if ((arg === "-l" || arg === "--limit") && i + 1 < args.length) {
      limit = Number.parseInt(args[++i], 10);
    } else if (arg === "--no-extra") {
      noExtra = true;
    } else if (arg === "-A" || arg === "--all") {
      limit = 0; // unlimited
    } else if (!arg.startsWith("-")) {
      fileArgs.push(arg);
    }
  }

  const { headers, data, error } = await readCsvInput(fileArgs, ctx);
  if (error) return error;

  // If no columns specified, use all columns except group column
  let targetCols =
    selectCols.length > 0 ? selectCols : headers.filter((h) => h !== groupCol);

  // If groupCol specified, only count that one column (the non-group columns)
  if (groupCol && selectCols.length === 0) {
    targetCols = headers.filter((h) => h !== groupCol);
  }

  const results: CsvData = [];
  const resultHeaders = groupCol
    ? ["field", groupCol, "value", "count"]
    : ["field", "value", "count"];

  if (groupCol) {
    // Group by column first, then count values within each group
    const groups = new Map<string, CsvData>();
    for (const row of data) {
      const key = String(row[groupCol] ?? "");
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)?.push(row);
    }

    for (const col of targetCols) {
      for (const [groupKey, groupData] of groups) {
        // Count occurrences within group
        const counts = new Map<string, number>();
        for (const row of groupData) {
          const val = row[col];
          const key =
            val === "" || val === null || val === undefined ? "" : String(val);
          counts.set(key, (counts.get(key) || 0) + 1);
        }

        // Sort by count descending
        let entries = [...counts.entries()].sort((a, b) => {
          if (b[1] !== a[1]) return b[1] - a[1];
          return a[0].localeCompare(b[0]);
        });

        if (noExtra) {
          entries = entries.filter(([val]) => val !== "");
        }

        if (limit > 0) {
          entries = entries.slice(0, limit);
        }

        for (const [val, count] of entries) {
          results.push({
            field: col,
            [groupCol]: groupKey,
            value: val === "" ? "<empty>" : val,
            count,
          });
        }
      }
    }
  } else {
    // Original behavior without grouping
    for (const col of targetCols) {
      const counts = new Map<string, number>();
      for (const row of data) {
        const val = row[col];
        const key =
          val === "" || val === null || val === undefined ? "" : String(val);
        counts.set(key, (counts.get(key) || 0) + 1);
      }

      let entries = [...counts.entries()].sort((a, b) => {
        if (b[1] !== a[1]) return b[1] - a[1];
        return a[0].localeCompare(b[0]);
      });

      if (noExtra) {
        entries = entries.filter(([val]) => val !== "");
      }

      if (limit > 0) {
        entries = entries.slice(0, limit);
      }

      for (const [val, count] of entries) {
        results.push({
          field: col,
          value: val === "" ? "<empty>" : val,
          count,
        });
      }
    }
  }

  return { stdout: formatCsv(resultHeaders, results), stderr: "", exitCode: 0 };
}

export async function cmdStats(
  args: string[],
  ctx: CommandContext,
): Promise<ExecResult> {
  let columns: string[] = [];
  const fileArgs: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-s" && i + 1 < args.length) {
      columns = args[++i].split(",");
    } else if (!arg.startsWith("-")) {
      fileArgs.push(arg);
    }
  }

  const { headers, data, error } = await readCsvInput(fileArgs, ctx);
  if (error) return error;

  const targetCols = columns.length > 0 ? columns : headers;
  const statsHeaders = ["field", "type", "count", "min", "max", "mean"];
  const results: CsvData = [];

  for (const col of targetCols) {
    const values = data
      .map((r) => r[col])
      .filter((v) => v !== null && v !== undefined);
    const nums = values
      .map((v) => (typeof v === "number" ? v : Number.parseFloat(String(v))))
      .filter((n) => !Number.isNaN(n));

    const isNumeric = nums.length === values.length && nums.length > 0;

    results.push({
      field: col,
      type: isNumeric ? "Number" : "String",
      count: values.length,
      min: isNumeric ? Math.min(...nums) : "",
      max: isNumeric ? Math.max(...nums) : "",
      mean: isNumeric
        ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 1e10) /
          1e10
        : "",
    });
  }

  return { stdout: formatCsv(statsHeaders, results), stderr: "", exitCode: 0 };
}
