/**
 * Aggregation functions for xan command
 */

import { ExecutionLimitError } from "../../interpreter/errors.js";
import { utf8ByteLength } from "../printf/escapes.js";
import { type EvaluateOptions, evaluate } from "../query-engine/index.js";
import { type CsvData, type CsvRow, createSafeRow, safeSetRow } from "./csv.js";
import { parseMoonblade } from "./moonblade-parser.js";
import { moonbladeToJq } from "./moonblade-to-jq.js";

export interface AggregationLimits {
  maxArrayElements?: number;
  maxStringLength?: number;
  maxIterations?: number;
  maxDepth?: number;
}

/** Aggregation specification from parsed expression */
export interface AggSpec {
  func: string;
  expr: string; // Raw expression (could be column name or complex expression)
  alias: string;
}

/**
 * Parse aggregation expression: "func(expr) as alias" or "func(expr)"
 * Handles nested parentheses in expressions like sum(add(a, b))
 */
export function parseAggExpr(
  expr: string,
  limits: AggregationLimits = {},
): AggSpec[] {
  const maxArrayElements = limits.maxArrayElements ?? 100_000;
  const maxStringLength = limits.maxStringLength ?? 10 * 1024 * 1024;
  const maxIterations = limits.maxIterations ?? 100_000;
  const maxDepth = limits.maxDepth ?? 100;
  if (utf8ByteLength(expr) > maxStringLength) {
    throw new ExecutionLimitError(
      `xan: aggregation expression length limit exceeded (${maxStringLength} bytes)`,
      "string_length",
    );
  }
  const specs: AggSpec[] = [];
  let i = 0;
  let operations = 0;
  const useOperation = (): void => {
    if (++operations > maxIterations) {
      throw new ExecutionLimitError(
        `xan: aggregation parser operation limit exceeded (${maxIterations})`,
        "iterations",
      );
    }
  };

  while (i < expr.length) {
    useOperation();
    // Skip whitespace and commas
    while (i < expr.length && (expr[i] === " " || expr[i] === ",")) i++;
    if (i >= expr.length) break;

    // Parse function name
    const funcStart = i;
    while (i < expr.length && /\w/.test(expr[i])) i++;
    const func = expr.slice(funcStart, i);

    // Skip whitespace
    while (i < expr.length && expr[i] === " ") i++;

    // Expect opening paren
    if (expr[i] !== "(") break;
    i++; // skip (

    // Parse expression inside parens (handling nested parens)
    let parenDepth = 1;
    const exprStart = i;
    while (i < expr.length && parenDepth > 0) {
      useOperation();
      if (expr[i] === "(") parenDepth++;
      else if (expr[i] === ")") parenDepth--;
      if (parenDepth > maxDepth) {
        throw new ExecutionLimitError(
          `xan: aggregation parser depth limit exceeded (${maxDepth})`,
          "recursion",
        );
      }
      if (parenDepth > 0) i++;
    }
    const innerExpr = expr.slice(exprStart, i).trim();
    i++; // skip )

    // Skip whitespace
    while (i < expr.length && expr[i] === " ") i++;

    // Check for "as alias"
    let alias = "";
    if (expr.slice(i, i + 3).toLowerCase() === "as ") {
      i += 3;
      while (i < expr.length && expr[i] === " ") i++;
      const aliasStart = i;
      while (i < expr.length && /\w/.test(expr[i])) i++;
      alias = expr.slice(aliasStart, i);
    }

    // Default alias preserves original syntax
    if (!alias) {
      alias = innerExpr ? `${func}(${innerExpr})` : `${func}()`;
    }

    if (specs.length >= maxArrayElements) {
      throw new ExecutionLimitError(
        `xan: aggregation specification limit exceeded (${maxArrayElements})`,
        "array_elements",
      );
    }
    specs.push({ func, expr: innerExpr, alias });
  }

  return specs;
}

/** Check if expression is a simple column reference */
function isSimpleColumn(expr: string): boolean {
  return /^\w+$/.test(expr);
}

/** Evaluate a moonblade expression for a row */
function evalExpr(
  row: CsvRow,
  ast: ReturnType<typeof moonbladeToJq>,
  evalOptions: EvaluateOptions,
): unknown {
  const results = evaluate(row, ast, evalOptions);
  return results.length > 0 ? results[0] : null;
}

/** Compute aggregation on data */
export function computeAgg(
  data: CsvData,
  spec: AggSpec,
  evalOptions: EvaluateOptions = {},
  limits: AggregationLimits = {},
): number | string | boolean | null {
  const { func, expr } = spec;
  const maxArrayElements = limits.maxArrayElements ?? 100_000;
  const maxStringLength = limits.maxStringLength ?? 10 * 1024 * 1024;
  const maxIterations = limits.maxIterations ?? 100_000;
  const parserLimits = {
    maxSourceLength: maxStringLength,
    maxTokens: maxArrayElements,
    maxAstNodes: maxArrayElements,
    maxOperations: maxIterations,
    maxDepth: limits.maxDepth ?? 100,
  };
  if (data.length > maxArrayElements) {
    throw new ExecutionLimitError(
      `xan: aggregation input limit exceeded (${maxArrayElements})`,
      "array_elements",
    );
  }

  // Special case: count() with no expression
  if (func === "count" && !expr) {
    return data.length;
  }

  const simpleColumn = isSimpleColumn(expr);
  const ast = simpleColumn
    ? null
    : moonbladeToJq(parseMoonblade(expr, parserLimits), true, parserLimits);
  let evaluateRow: (row: CsvRow) => unknown;
  if (simpleColumn) {
    evaluateRow = (row) => row[expr];
  } else {
    if (ast === null) {
      throw new Error("xan: missing compiled aggregation expression");
    }
    evaluateRow = (row) => evalExpr(row, ast, evalOptions);
  }

  if (func === "all" || func === "any") {
    let iterations = 0;
    for (const row of data) {
      if (++iterations > maxIterations) {
        throw new ExecutionLimitError(
          `xan: aggregation iteration limit exceeded (${maxIterations})`,
          "iterations",
        );
      }
      const truthy = !!evaluateRow(row);
      if (func === "all" && !truthy) return false;
      if (func === "any" && truthy) return true;
    }
    return func === "all";
  }

  const values: unknown[] = [];
  let iterations = 0;
  for (const row of data) {
    if (++iterations > maxIterations) {
      throw new ExecutionLimitError(
        `xan: aggregation iteration limit exceeded (${maxIterations})`,
        "iterations",
      );
    }
    const value = evaluateRow(row);
    if (value !== null && value !== undefined) {
      if (values.length >= maxArrayElements) {
        throw new ExecutionLimitError(
          `xan: aggregation value limit exceeded (${maxArrayElements})`,
          "array_elements",
        );
      }
      values.push(value);
    }
  }

  switch (func) {
    case "count": {
      // count(expr) - count rows where expression is truthy
      if (simpleColumn) {
        return values.length;
      }
      // For expressions like count(n > 2), count truthy values
      return values.filter((v) => !!v).length;
    }

    case "sum": {
      const nums = values.map((v) =>
        typeof v === "number" ? v : Number.parseFloat(String(v)),
      );
      return nums.reduce((a, b) => a + b, 0);
    }

    case "mean":
    case "avg": {
      const nums = values.map((v) =>
        typeof v === "number" ? v : Number.parseFloat(String(v)),
      );
      return nums.length > 0
        ? nums.reduce((a, b) => a + b, 0) / nums.length
        : 0;
    }

    case "min": {
      let minimum: number | null = null;
      for (const value of values) {
        const number =
          typeof value === "number" ? value : Number.parseFloat(String(value));
        minimum = minimum === null ? number : Math.min(minimum, number);
      }
      return minimum;
    }

    case "max": {
      let maximum: number | null = null;
      for (const value of values) {
        const number =
          typeof value === "number" ? value : Number.parseFloat(String(value));
        maximum = maximum === null ? number : Math.max(maximum, number);
      }
      return maximum;
    }

    case "first":
      return values.length > 0 ? (values[0] as string | number | null) : null;

    case "last":
      return values.length > 0
        ? (values[values.length - 1] as string | number | null)
        : null;

    case "median": {
      const nums = values
        .map((v) => (typeof v === "number" ? v : Number.parseFloat(String(v))))
        .filter((n) => !Number.isNaN(n))
        .sort((a, b) => a - b);
      if (nums.length === 0) return null;
      const mid = Math.floor(nums.length / 2);
      if (nums.length % 2 === 0) {
        return (nums[mid - 1] + nums[mid]) / 2;
      }
      return nums[mid];
    }

    case "mode": {
      const counts = new Map<string, number>();
      for (const v of values) {
        const key = String(v);
        counts.set(key, (counts.get(key) || 0) + 1);
      }
      let maxCount = 0;
      let mode: string | null = null;
      for (const [val, count] of counts) {
        if (count > maxCount) {
          maxCount = count;
          mode = val;
        }
      }
      return mode;
    }

    case "cardinality": {
      const unique = new Set(values.map((v) => String(v)));
      return unique.size;
    }

    case "values": {
      return joinAggregationValues(values, false, maxStringLength);
    }

    case "distinct_values": {
      return joinAggregationValues(values, true, maxStringLength);
    }

    default:
      return null;
  }
}

/** Build aggregation result row */
export function buildAggRow(
  data: CsvData,
  specs: AggSpec[],
  evalOptions: EvaluateOptions = {},
  limits: AggregationLimits = {},
): CsvRow {
  const row: CsvRow = createSafeRow();
  for (const spec of specs) {
    safeSetRow(row, spec.alias, computeAgg(data, spec, evalOptions, limits));
  }
  return row;
}

function joinAggregationValues(
  values: unknown[],
  distinct: boolean,
  maxStringLength: number,
): string {
  const strings: string[] = [];
  const seen = distinct ? new Set<string>() : null;
  let outputBytes = 0;
  for (const value of values) {
    const stringValue = String(value);
    if (seen?.has(stringValue)) continue;
    seen?.add(stringValue);
    const addedBytes =
      utf8ByteLength(stringValue) + (strings.length > 0 ? 1 : 0);
    if (addedBytes > maxStringLength - outputBytes) {
      throw new ExecutionLimitError(
        `xan: aggregation string limit exceeded (${maxStringLength} bytes)`,
        "string_length",
      );
    }
    strings.push(stringValue);
    outputBytes += addedBytes;
  }
  if (distinct) strings.sort();
  return strings.join("|");
}
