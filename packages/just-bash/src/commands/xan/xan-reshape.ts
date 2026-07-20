/**
 * Reshape commands: explode, implode, flatmap, pivot, join, merge
 */

import { boundedJoin, checkedAdd } from "../../bounded-builder.js";
import { ExecutionLimitError } from "../../interpreter/errors.js";
import type { CommandContext, ExecResult } from "../../types.js";
import {
  type CsvData,
  type CsvRow,
  createSafeRow,
  DerivedCsvBudget,
  formatCsv,
  readCsvInput,
  safeSetRow,
  toSafeRow,
} from "./csv.js";

/**
 * Explode: split delimited column values into multiple rows
 * Usage: xan explode COLUMN [OPTIONS] [FILE]
 *   -s, --separator SEP  Value separator (default: |)
 *   --drop-empty         Drop rows where column is empty
 *   -r, --rename NAME    Rename the column
 */
export async function cmdExplode(
  args: string[],
  ctx: CommandContext,
): Promise<ExecResult> {
  let column = "";
  let separator = "|";
  let dropEmpty = false;
  let rename = "";
  const fileArgs: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if ((arg === "-s" || arg === "--separator") && i + 1 < args.length) {
      separator = args[++i];
    } else if (arg === "--drop-empty") {
      dropEmpty = true;
    } else if ((arg === "-r" || arg === "--rename") && i + 1 < args.length) {
      rename = args[++i];
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
      stderr: "xan explode: usage: xan explode COLUMN [FILE]\n",
      exitCode: 1,
    };
  }

  const { headers, data, error } = await readCsvInput(fileArgs, ctx);
  if (error) return error;

  if (!headers.includes(column)) {
    return {
      stdout: "",
      stderr: `xan explode: column '${column}' not found\n`,
      exitCode: 1,
    };
  }

  const newHeaders = rename
    ? headers.map((h) => (h === column ? rename : h))
    : headers;
  const targetCol = rename || column;
  const newData: CsvData = [];
  const resultBudget = new DerivedCsvBudget(ctx, "xan explode");

  for (const row of data) {
    const value = row[column];
    const strValue = value === null || value === undefined ? "" : String(value);

    if (strValue === "") {
      if (!dropEmpty) {
        resultBudget.addRow(newHeaders.length);
        const newRow: CsvRow = toSafeRow(row);
        if (rename) {
          delete newRow[column];
          safeSetRow(newRow, targetCol, "");
        }
        newData.push(newRow);
      }
    } else {
      let start = 0;
      while (start <= strValue.length) {
        resultBudget.addRow(newHeaders.length);
        const next =
          separator === "" ? start + 1 : strValue.indexOf(separator, start);
        const end = next === -1 ? strValue.length : next;
        const part = strValue.slice(start, end);
        const newRow: CsvRow = toSafeRow(row);
        if (rename) {
          delete newRow[column];
        }
        safeSetRow(newRow, targetCol, part);
        newData.push(newRow);
        if (next === -1 || (separator === "" && start >= strValue.length - 1)) {
          break;
        }
        start = separator === "" ? next : next + separator.length;
      }
    }
  }

  return {
    stdout: formatCsv(newHeaders, newData, ctx),
    stderr: "",
    exitCode: 0,
  };
}

/**
 * Implode: combine consecutive rows with same key, joining column values
 * Usage: xan implode COLUMN [OPTIONS] [FILE]
 *   -s, --separator SEP  Value separator (default: |)
 *   -r, --rename NAME    Rename the column
 */
export async function cmdImplode(
  args: string[],
  ctx: CommandContext,
): Promise<ExecResult> {
  let column = "";
  let separator = "|";
  let rename = "";
  const fileArgs: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if ((arg === "-s" || arg === "--sep") && i + 1 < args.length) {
      separator = args[++i];
    } else if ((arg === "-r" || arg === "--rename") && i + 1 < args.length) {
      rename = args[++i];
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
      stderr: "xan implode: usage: xan implode COLUMN [FILE]\n",
      exitCode: 1,
    };
  }

  const { headers, data, error } = await readCsvInput(fileArgs, ctx);
  if (error) return error;

  if (!headers.includes(column)) {
    return {
      stdout: "",
      stderr: `xan implode: column '${column}' not found\n`,
      exitCode: 1,
    };
  }

  // Get key columns (all columns except the implode column)
  const keyCols = headers.filter((h) => h !== column);

  const newHeaders = rename
    ? headers.map((h) => (h === column ? rename : h))
    : headers;
  const targetCol = rename || column;

  // Group consecutive rows with same key
  const newData: CsvData = [];
  const resultBudget = new DerivedCsvBudget(ctx, "xan implode");
  let currentKey: string | null = null;
  let currentValues: string[] = [];
  let currentRow: CsvRow | null = null;

  for (const row of data) {
    resultBudget.consumeWork();
    const key = JSON.stringify(keyCols.map((k) => String(row[k] ?? "")));
    const value = row[column];
    const strValue = value === null || value === undefined ? "" : String(value);

    if (key !== currentKey) {
      // Flush previous group
      if (currentRow !== null) {
        const newRow: CsvRow = toSafeRow(currentRow);
        if (rename) {
          delete newRow[column];
        }
        safeSetRow(
          newRow,
          targetCol,
          boundedJoin(
            currentValues,
            separator,
            Math.min(ctx.limits.maxStringLength, ctx.limits.maxOutputSize),
            "xan implode",
          ),
        );
        resultBudget.addRow(newHeaders.length);
        newData.push(newRow);
      }
      // Start new group
      currentKey = key;
      currentValues = [strValue];
      currentRow = row;
    } else {
      // Add to current group
      currentValues.push(strValue);
    }
  }

  // Flush last group
  if (currentRow !== null) {
    const newRow: CsvRow = toSafeRow(currentRow);
    if (rename) {
      delete newRow[column];
    }
    safeSetRow(
      newRow,
      targetCol,
      boundedJoin(
        currentValues,
        separator,
        Math.min(ctx.limits.maxStringLength, ctx.limits.maxOutputSize),
        "xan implode",
      ),
    );
    resultBudget.addRow(newHeaders.length);
    newData.push(newRow);
  }

  return {
    stdout: formatCsv(newHeaders, newData, ctx),
    stderr: "",
    exitCode: 0,
  };
}

/**
 * Join: join two CSV files on key columns
 * Usage: xan join KEY1 FILE1 KEY2 FILE2 [OPTIONS]
 *   --left       Left outer join (keep all rows from first file)
 *   --right      Right outer join (keep all rows from second file)
 *   --full       Full outer join (keep all rows from both files)
 *   -D, --default VALUE  Default value for missing fields
 */
export async function cmdJoin(
  args: string[],
  ctx: CommandContext,
): Promise<ExecResult> {
  let key1 = "";
  let file1 = "";
  let key2 = "";
  let file2 = "";
  let joinType: "inner" | "left" | "right" | "full" = "inner";
  let defaultValue = "";

  let positionalCount = 0;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--left") {
      joinType = "left";
    } else if (arg === "--right") {
      joinType = "right";
    } else if (arg === "--full") {
      joinType = "full";
    } else if ((arg === "-D" || arg === "--default") && i + 1 < args.length) {
      defaultValue = args[++i];
    } else if (!arg.startsWith("-")) {
      positionalCount++;
      if (positionalCount === 1) key1 = arg;
      else if (positionalCount === 2) file1 = arg;
      else if (positionalCount === 3) key2 = arg;
      else if (positionalCount === 4) file2 = arg;
    }
  }

  if (!key1 || !file1 || !key2 || !file2) {
    return {
      stdout: "",
      stderr: "xan join: usage: xan join KEY1 FILE1 KEY2 FILE2 [OPTIONS]\n",
      exitCode: 1,
    };
  }

  // Read both files
  const result1 = await readCsvInput([file1], ctx);
  if (result1.error) return result1.error;

  const result2 = await readCsvInput([file2], ctx);
  if (result2.error) return result2.error;

  const { headers: headers1, data: data1 } = result1;
  const { headers: headers2, data: data2 } = result2;

  if (!headers1.includes(key1)) {
    return {
      stdout: "",
      stderr: `xan join: column '${key1}' not found in first file\n`,
      exitCode: 1,
    };
  }
  if (!headers2.includes(key2)) {
    return {
      stdout: "",
      stderr: `xan join: column '${key2}' not found in second file\n`,
      exitCode: 1,
    };
  }

  // Build index for second file
  const index2 = new Map<string, CsvRow[]>();
  for (const row of data2) {
    ctx.executionScope?.consumeWork(1, "xan join index");
    const keyVal = String(row[key2] ?? "");
    if (!index2.has(keyVal)) {
      index2.set(keyVal, []);
    }
    index2.get(keyVal)?.push(row);
  }

  // Combined headers - deduplicate columns from second file
  // Keep all headers from file1, add only unique headers from file2
  const headers1Set = new Set(headers1);
  const headers2Unique = headers2.filter((h) => !headers1Set.has(h));
  if (
    checkedAdd(headers1.length, headers2Unique.length, "xan join") >
    ctx.limits.maxArrayElements
  ) {
    throw new ExecutionLimitError(
      `xan join: output column limit exceeded (${ctx.limits.maxArrayElements})`,
      "array_elements",
    );
  }
  const newHeaders = [...headers1, ...headers2Unique];
  const newData: CsvData = [];
  const resultBudget = new DerivedCsvBudget(ctx, "xan join");
  const matched2Keys = new Set<string>();

  // Prove the join product fits before allocating its first output row.
  let prospectiveRows = 0;
  for (const row1 of data1) {
    ctx.executionScope?.consumeWork(1, "xan join cardinality");
    const matches = index2.get(String(row1[key1] ?? ""));
    prospectiveRows = checkedAdd(
      prospectiveRows,
      matches?.length ?? (joinType === "left" || joinType === "full" ? 1 : 0),
      "xan join",
    );
  }
  if (joinType === "right" || joinType === "full") {
    const leftKeys = new Set<string>();
    for (const row of data1) {
      ctx.executionScope?.throwIfAborted("xan join cardinality");
      leftKeys.add(String(row[key1] ?? ""));
    }
    for (const row2 of data2) {
      ctx.executionScope?.throwIfAborted("xan join cardinality");
      if (!leftKeys.has(String(row2[key2] ?? ""))) {
        prospectiveRows = checkedAdd(prospectiveRows, 1, "xan join");
      }
    }
  }
  resultBudget.addRows(prospectiveRows, newHeaders.length);

  // Process joins
  for (const row1 of data1) {
    ctx.executionScope?.throwIfAborted("xan join output");
    const keyVal = String(row1[key1] ?? "");
    const matches = index2.get(keyVal);

    if (matches && matches.length > 0) {
      matched2Keys.add(keyVal);
      for (const row2 of matches) {
        const newRow: CsvRow = createSafeRow();
        for (const h of headers1) {
          safeSetRow(newRow, h, row1[h]);
        }
        for (const h of headers2Unique) {
          safeSetRow(newRow, h, row2[h]);
        }
        newData.push(newRow);
      }
    } else if (joinType === "left" || joinType === "full") {
      // No match, include left row with defaults for right columns
      const newRow: CsvRow = createSafeRow();
      for (const h of headers1) {
        safeSetRow(newRow, h, row1[h]);
      }
      for (const h of headers2Unique) {
        safeSetRow(newRow, h, defaultValue);
      }
      newData.push(newRow);
    }
  }

  // For right/full join, add unmatched rows from second file
  if (joinType === "right" || joinType === "full") {
    for (const row2 of data2) {
      ctx.executionScope?.throwIfAborted("xan join output");
      const keyVal = String(row2[key2] ?? "");
      if (!matched2Keys.has(keyVal)) {
        const newRow: CsvRow = createSafeRow();
        for (const h of headers1) {
          // Use value from row2 if it exists in headers2, else default
          safeSetRow(newRow, h, headers2.includes(h) ? row2[h] : defaultValue);
        }
        for (const h of headers2Unique) {
          safeSetRow(newRow, h, row2[h]);
        }
        newData.push(newRow);
      }
    }
  }

  return {
    stdout: formatCsv(newHeaders, newData, ctx),
    stderr: "",
    exitCode: 0,
  };
}

/**
 * Pivot: reshape data by turning row values into columns
 * Usage: xan pivot COLUMN AGG_EXPR [OPTIONS] [FILE]
 *   -g, --groupby COLS   Group by these columns (default: all other columns)
 */
export async function cmdPivot(
  args: string[],
  ctx: CommandContext,
): Promise<ExecResult> {
  let pivotCol = "";
  let aggExpr = "";
  let groupCols: string[] = [];
  const fileArgs: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if ((arg === "-g" || arg === "--groupby") && i + 1 < args.length) {
      groupCols = args[++i].split(",").map((s) => s.trim());
    } else if (!arg.startsWith("-")) {
      if (!pivotCol) {
        pivotCol = arg;
      } else if (!aggExpr) {
        aggExpr = arg;
      } else {
        fileArgs.push(arg);
      }
    }
  }

  if (!pivotCol || !aggExpr) {
    return {
      stdout: "",
      stderr: "xan pivot: usage: xan pivot COLUMN AGG_EXPR [OPTIONS] [FILE]\n",
      exitCode: 1,
    };
  }

  const { headers, data, error } = await readCsvInput(fileArgs, ctx);
  if (error) return error;

  if (!headers.includes(pivotCol)) {
    return {
      stdout: "",
      stderr: `xan pivot: column '${pivotCol}' not found\n`,
      exitCode: 1,
    };
  }

  // Parse aggregation expression (simple: func(col))
  const aggMatch = aggExpr.match(/^(\w+)\((\w+)\)$/);
  if (!aggMatch) {
    return {
      stdout: "",
      stderr: `xan pivot: invalid aggregation expression '${aggExpr}'\n`,
      exitCode: 1,
    };
  }
  const [, aggFunc, aggCol] = aggMatch;

  // Determine group columns if not specified
  if (groupCols.length === 0) {
    groupCols = headers.filter((h) => h !== pivotCol && h !== aggCol);
  }

  // Get unique pivot values (preserving order)
  const pivotValues: string[] = [];
  const pivotValueSet = new Set<string>();
  for (const row of data) {
    ctx.executionScope?.consumeWork(1, "xan pivot values");
    const val = String(row[pivotCol] ?? "");
    if (!pivotValueSet.has(val)) {
      if (pivotValues.length >= ctx.limits.maxArrayElements) {
        throw new ExecutionLimitError(
          `xan pivot: pivot value limit exceeded (${ctx.limits.maxArrayElements})`,
          "array_elements",
        );
      }
      pivotValueSet.add(val);
      pivotValues.push(val);
    }
  }

  // Group data
  const groups = new Map<
    string,
    {
      keyParts: string[];
      pivots: Map<string, (string | number | boolean | null)[]>;
    }
  >();
  const groupOrder: string[] = [];

  for (const row of data) {
    ctx.executionScope?.consumeWork(1, "xan pivot groups");
    const groupKeyParts = groupCols.map((c) => String(row[c] ?? ""));
    const groupKey = JSON.stringify(groupKeyParts);
    const pivotVal = String(row[pivotCol] ?? "");
    const aggVal = row[aggCol];

    if (!groups.has(groupKey)) {
      groups.set(groupKey, { keyParts: groupKeyParts, pivots: new Map() });
      groupOrder.push(groupKey);
    }
    const group = groups.get(groupKey);
    if (!group) continue;
    if (!group.pivots.has(pivotVal)) {
      group.pivots.set(pivotVal, []);
    }
    group.pivots.get(pivotVal)?.push(aggVal);
  }

  // Build output
  const collidingHeader = pivotValues.find((value) =>
    groupCols.includes(value),
  );
  if (collidingHeader !== undefined) {
    return {
      stdout: "",
      stderr: `xan pivot: duplicate output header '${collidingHeader}'\n`,
      exitCode: 1,
    };
  }
  const outputColumnCount = checkedAdd(
    groupCols.length,
    pivotValues.length,
    "xan pivot",
  );
  if (outputColumnCount > ctx.limits.maxArrayElements) {
    throw new ExecutionLimitError(
      `xan pivot: output column limit exceeded (${ctx.limits.maxArrayElements})`,
      "array_elements",
    );
  }
  const resultBudget = new DerivedCsvBudget(ctx, "xan pivot");
  resultBudget.addRows(groupOrder.length, outputColumnCount);
  const newHeaders = [...groupCols, ...pivotValues];
  const newData: CsvData = [];

  for (const groupKey of groupOrder) {
    ctx.executionScope?.throwIfAborted("xan pivot output");
    const group = groups.get(groupKey);
    if (!group) continue;
    const row: CsvRow = createSafeRow();

    // Add group key values
    for (let i = 0; i < groupCols.length; i++) {
      safeSetRow(row, groupCols[i], group.keyParts[i]);
    }

    // Add aggregated values for each pivot column
    for (const pivotVal of pivotValues) {
      const values = group.pivots.get(pivotVal) || [];
      safeSetRow(row, pivotVal, computeSimpleAgg(aggFunc, values));
    }

    newData.push(row);
  }

  return {
    stdout: formatCsv(newHeaders, newData, ctx),
    stderr: "",
    exitCode: 0,
  };
}

function computeSimpleAgg(
  func: string,
  values: (string | number | boolean | null)[],
): string | number | null {
  let numericCount = 0;
  let sum = 0;
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const number =
      typeof value === "number" ? value : Number.parseFloat(String(value));
    if (Number.isNaN(number)) continue;
    numericCount++;
    sum += number;
    minimum = Math.min(minimum, number);
    maximum = Math.max(maximum, number);
  }

  switch (func) {
    case "count":
      return values.length;
    case "sum":
      return sum;
    case "mean":
    case "avg":
      return numericCount > 0 ? sum / numericCount : null;
    case "min":
      return numericCount > 0 ? minimum : null;
    case "max":
      return numericCount > 0 ? maximum : null;
    case "first":
      return values.length > 0 ? String(values[0] ?? "") : null;
    case "last":
      return values.length > 0 ? String(values[values.length - 1] ?? "") : null;
    default:
      return null;
  }
}

/**
 * Merge: merge multiple sorted CSV files
 * Usage: xan merge [OPTIONS] FILE1 FILE2 ...
 *   -s, --sort COLUMN   Sort column (files must be pre-sorted by this)
 */
export async function cmdMerge(
  args: string[],
  ctx: CommandContext,
): Promise<ExecResult> {
  let sortCol = "";
  const fileArgs: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if ((arg === "-s" || arg === "--sort") && i + 1 < args.length) {
      sortCol = args[++i];
    } else if (!arg.startsWith("-")) {
      fileArgs.push(arg);
    }
  }

  if (fileArgs.length < 2) {
    return {
      stdout: "",
      stderr: "xan merge: usage: xan merge [OPTIONS] FILE1 FILE2 ...\n",
      exitCode: 1,
    };
  }

  // Read all files
  const allData: { headers: string[]; data: CsvData }[] = [];
  let commonHeaders: string[] | null = null;

  for (const file of fileArgs) {
    const result = await readCsvInput([file], ctx);
    if (result.error) return result.error;

    if (commonHeaders === null) {
      commonHeaders = result.headers;
    } else if (
      JSON.stringify(commonHeaders) !== JSON.stringify(result.headers)
    ) {
      return {
        stdout: "",
        stderr: "xan merge: all files must have the same headers\n",
        exitCode: 1,
      };
    }

    allData.push({ headers: result.headers, data: result.data });
  }

  if (!commonHeaders) {
    return { stdout: "", stderr: "", exitCode: 0 };
  }

  // Merge all data
  const merged: CsvData = [];
  const resultBudget = new DerivedCsvBudget(ctx, "xan merge");
  const mergedRows = allData.reduce(
    (count, entry) => checkedAdd(count, entry.data.length, "xan merge"),
    0,
  );
  resultBudget.addRows(mergedRows, commonHeaders.length);
  for (const { data } of allData) {
    for (const row of data) {
      ctx.executionScope?.throwIfAborted("xan merge output");
      merged.push(row);
    }
  }

  // Sort if column specified
  if (sortCol) {
    if (!commonHeaders.includes(sortCol)) {
      return {
        stdout: "",
        stderr: `xan merge: column '${sortCol}' not found\n`,
        exitCode: 1,
      };
    }
    merged.sort((a, b) => {
      const aVal = a[sortCol];
      const bVal = b[sortCol];
      const aNum =
        typeof aVal === "number" ? aVal : Number.parseFloat(String(aVal));
      const bNum =
        typeof bVal === "number" ? bVal : Number.parseFloat(String(bVal));
      if (!Number.isNaN(aNum) && !Number.isNaN(bNum)) {
        return aNum - bNum;
      }
      return String(aVal ?? "").localeCompare(String(bVal ?? ""));
    });
  }

  return {
    stdout: formatCsv(commonHeaders, merged, ctx),
    stderr: "",
    exitCode: 0,
  };
}
