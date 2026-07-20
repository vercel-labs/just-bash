/**
 * Aggregation commands: agg, groupby, frequency, stats
 */

import type { ExecResult, RuntimeCommandContext } from "../../types.js";
import type { EvaluateOptions } from "../query-engine/index.js";
import {
  type AggregationLimits,
  buildAggRow,
  computeAgg,
  estimateSortingWork,
  parseAggExpr,
} from "./aggregation.js";
import {
  type CsvData,
  type CsvRow,
  createSafeRow,
  DerivedCsvBudget,
  formatCsv,
  readCsvInput,
  safeSetRow,
} from "./csv.js";

function getAggregationLimits(
  ctx: RuntimeCommandContext,
  budget: DerivedCsvBudget,
): AggregationLimits {
  return {
    maxArrayElements: ctx.limits.maxArrayElements,
    maxStringLength: ctx.limits.maxStringLength,
    maxIterations: ctx.limits.maxJqIterations,
    maxDepth: ctx.limits.maxQueryDepth,
    consumeWork: (units = 1) => budget.consumeWork(units),
  };
}

function frequencyResultCount(
  counts: ReadonlyMap<string, number>,
  noExtra: boolean,
  limit: number,
): number {
  const available = counts.size - (noExtra && counts.has("") ? 1 : 0);
  return limit > 0 ? Math.min(available, limit) : available;
}

export async function cmdAgg(
  args: string[],
  ctx: RuntimeCommandContext,
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
      ? {
          maxIterations: ctx.limits.maxJqIterations,
          maxStringLength: ctx.limits.maxStringLength,
        }
      : undefined,
  };

  const budget = new DerivedCsvBudget(ctx, "xan agg");
  const aggregationLimits = getAggregationLimits(ctx, budget);
  const specs = parseAggExpr(expr, aggregationLimits);
  const headers = specs.map((s) => s.alias);
  budget.addRow(headers.length);
  const row = buildAggRow(data, specs, evalOptions, aggregationLimits);

  return { stdout: formatCsv(headers, [row], ctx), stderr: "", exitCode: 0 };
}

export async function cmdGroupby(
  args: string[],
  ctx: RuntimeCommandContext,
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
      ? {
          maxIterations: ctx.limits.maxJqIterations,
          maxStringLength: ctx.limits.maxStringLength,
        }
      : undefined,
  };

  const groupKeys = groupCols.split(",");
  const budget = new DerivedCsvBudget(ctx, "xan groupby");
  const aggregationLimits = getAggregationLimits(ctx, budget);
  const specs = parseAggExpr(aggExpr, aggregationLimits);
  const headers = [...groupKeys, ...specs.map((s) => s.alias)];

  // Group rows by key - use array to preserve first-seen order
  const groupOrder: string[] = [];
  const groups = new Map<string, CsvData>();
  for (const row of data) {
    budget.consumeWork(groupKeys.length + 1);
    const key = JSON.stringify(groupKeys.map((k) => String(row[k])));
    if (!groups.has(key)) {
      budget.addRow(headers.length);
      groups.set(key, []);
      groupOrder.push(key);
    }
    groups.get(key)?.push(row);
  }

  // Compute aggregates for each group
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
      safeSetRow(
        row,
        spec.alias,
        computeAgg(groupData, spec, evalOptions, aggregationLimits),
      );
    }
    results.push(row);
  }

  return { stdout: formatCsv(headers, results, ctx), stderr: "", exitCode: 0 };
}

export async function cmdFrequency(
  args: string[],
  ctx: RuntimeCommandContext,
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
  if (!Number.isSafeInteger(limit) || limit < 0) {
    return {
      stdout: "",
      stderr: "xan frequency: limit must be a non-negative safe integer\n",
      exitCode: 1,
    };
  }
  const budget = new DerivedCsvBudget(ctx, "xan frequency");

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
      budget.consumeWork();
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
          budget.consumeWork();
          const val = row[col];
          const key =
            val === "" || val === null || val === undefined ? "" : String(val);
          counts.set(key, (counts.get(key) || 0) + 1);
        }

        budget.addRows(
          frequencyResultCount(counts, noExtra, limit),
          resultHeaders.length,
        );
        budget.consumeWork(estimateSortingWork(counts.size));
        const entries = [...counts.entries()].sort((a, b) => {
          if (b[1] !== a[1]) return b[1] - a[1];
          return a[0].localeCompare(b[0]);
        });

        let emitted = 0;
        for (const [val, count] of entries) {
          if (noExtra && val === "") continue;
          if (limit > 0 && emitted >= limit) break;
          const result = createSafeRow();
          safeSetRow(result, "field", col);
          safeSetRow(result, groupCol, groupKey);
          safeSetRow(result, "value", val === "" ? "<empty>" : val);
          safeSetRow(result, "count", count);
          results.push(result);
          emitted++;
        }
      }
    }
  } else {
    // Original behavior without grouping
    for (const col of targetCols) {
      const counts = new Map<string, number>();
      for (const row of data) {
        budget.consumeWork();
        const val = row[col];
        const key =
          val === "" || val === null || val === undefined ? "" : String(val);
        counts.set(key, (counts.get(key) || 0) + 1);
      }

      budget.addRows(
        frequencyResultCount(counts, noExtra, limit),
        resultHeaders.length,
      );
      budget.consumeWork(estimateSortingWork(counts.size));
      const entries = [...counts.entries()].sort((a, b) => {
        if (b[1] !== a[1]) return b[1] - a[1];
        return a[0].localeCompare(b[0]);
      });

      let emitted = 0;
      for (const [val, count] of entries) {
        if (noExtra && val === "") continue;
        if (limit > 0 && emitted >= limit) break;
        const result = createSafeRow();
        safeSetRow(result, "field", col);
        safeSetRow(result, "value", val === "" ? "<empty>" : val);
        safeSetRow(result, "count", count);
        results.push(result);
        emitted++;
      }
    }
  }

  return {
    stdout: formatCsv(resultHeaders, results, ctx),
    stderr: "",
    exitCode: 0,
  };
}

export async function cmdStats(
  args: string[],
  ctx: RuntimeCommandContext,
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
  const budget = new DerivedCsvBudget(ctx, "xan stats");
  budget.addRows(targetCols.length, statsHeaders.length);
  const results: CsvData = [];

  for (const col of targetCols) {
    let valueCount = 0;
    let numericCount = 0;
    let minimum = Number.POSITIVE_INFINITY;
    let maximum = Number.NEGATIVE_INFINITY;
    let sum = 0;

    // Keep statistics single-pass. Spreading a normal-profile CSV column into
    // Math.min/Math.max exceeds the engine's argument limit well before the
    // configured row ceiling and duplicates the attacker-sized input twice.
    for (const row of data) {
      ctx.executionScope?.consumeWork(1, "xan stats rows");
      const value = row[col];
      if (value === null || value === undefined) continue;

      valueCount++;
      const numericValue =
        typeof value === "number" ? value : Number.parseFloat(String(value));
      if (Number.isNaN(numericValue)) continue;

      numericCount++;
      minimum = Math.min(minimum, numericValue);
      maximum = Math.max(maximum, numericValue);
      sum += numericValue;
    }

    const isNumeric = numericCount === valueCount && numericCount > 0;

    const result = createSafeRow();
    safeSetRow(result, "field", col);
    safeSetRow(result, "type", isNumeric ? "Number" : "String");
    safeSetRow(result, "count", valueCount);
    safeSetRow(result, "min", isNumeric ? minimum : "");
    safeSetRow(result, "max", isNumeric ? maximum : "");
    safeSetRow(
      result,
      "mean",
      isNumeric ? Math.round((sum / numericCount) * 1e10) / 1e10 : "",
    );
    results.push(result);
  }

  return {
    stdout: formatCsv(statsHeaders, results, ctx),
    stderr: "",
    exitCode: 0,
  };
}
