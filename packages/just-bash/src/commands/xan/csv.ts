/**
 * CSV parsing and formatting utilities for xan command
 */

import Papa from "papaparse";
import {
  BoundedStringBuilder,
  checkedAdd,
  checkedMultiply,
} from "../../bounded-builder.js";
import { decodeBytesToUtf8, utf8ByteLength } from "../../encoding.js";
import { rethrowFatalExecutionError } from "../../fatal-execution-error.js";
import { ExecutionLimitError } from "../../interpreter/errors.js";
import type { CommandContext, ExecResult } from "../../types.js";

export interface CsvRow {
  [key: string]: string | number | boolean | null;
}

export type CsvData = CsvRow[];
export type CsvCells = Array<Array<string | number | boolean | null>>;

export interface CsvParseLimits {
  maxStringLength?: number;
  maxArrayElements?: number;
  maxRows?: number;
  maxCells?: number;
}

/** Command-wide prospective accounting for attacker-amplified CSV results. */
export class DerivedCsvBudget {
  private rows = 0;
  private cells = 0;

  constructor(
    private readonly ctx: CommandContext,
    private readonly site: string,
  ) {}

  consumeWork(units = 1): void {
    this.ctx.executionScope?.consumeWork(units, this.site);
  }

  addRow(cellCount: number): void {
    this.addRows(1, cellCount);
  }

  /** Reserve a known result cardinality before constructing any result rows. */
  addRows(rowCount: number, cellCount: number): void {
    const cells = checkedMultiply(rowCount, cellCount, this.site);
    if (
      !Number.isSafeInteger(rowCount) ||
      rowCount < 0 ||
      !Number.isSafeInteger(cellCount) ||
      cellCount < 0 ||
      cellCount > this.ctx.limits.maxArrayElements ||
      rowCount >
        Math.min(this.ctx.limits.maxCsvRows, this.ctx.limits.maxArrayElements) -
          this.rows ||
      cells > this.ctx.limits.maxCsvCells - this.cells
    ) {
      throw new ExecutionLimitError(
        `${this.site}: derived CSV result limit exceeded`,
        "array_elements",
      );
    }
    this.consumeWork(
      checkedMultiply(rowCount, checkedAdd(1, cellCount, this.site), this.site),
    );
    this.rows += rowCount;
    this.cells += cells;
  }
}

/**
 * Create a null-prototype CsvRow to prevent prototype pollution.
 * User-controlled CSV column names could match dangerous keys like
 * __proto__, constructor, or prototype. Using a null-prototype object
 * ensures these don't access the prototype chain.
 */
export function createSafeRow(): CsvRow {
  return Object.create(null) as CsvRow;
}

/**
 * Set a property on a CsvRow.
 * Since CsvRow uses null-prototype, this is safe from prototype pollution.
 */
export function safeSetRow(
  row: CsvRow,
  key: string,
  value: string | number | boolean | null,
): void {
  row[key] = value;
}

/**
 * Convert a plain object row to a safe null-prototype row.
 */
export function toSafeRow(plainRow: Record<string, unknown>): CsvRow {
  const safe = createSafeRow();
  for (const key of Object.keys(plainRow)) {
    const value = plainRow[key];
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      value === null
    ) {
      safe[key] = value;
    }
  }
  return safe;
}

/** Parse CSV input string to array of row objects */
export function parseCsv(
  input: string,
  limits: CsvParseLimits = {},
): { headers: string[]; data: CsvData } {
  const maxStringLength = limits.maxStringLength ?? 10 * 1024 * 1024;
  const maxArrayElements = limits.maxArrayElements ?? 100_000;
  const maxRows = limits.maxRows ?? maxArrayElements;
  const maxCells = limits.maxCells ?? 10_000_000;
  if (utf8ByteLength(input) > maxStringLength) {
    throw new ExecutionLimitError(
      `xan: CSV input size limit exceeded (${maxStringLength} bytes)`,
      "string_length",
    );
  }

  const safeData: CsvData = [];
  const normalizedInput = input.trim();
  const headerResult = Papa.parse<string[]>(normalizedInput, {
    preview: 1,
    skipEmptyLines: true,
  });
  let headers = headerResult.data[0] ?? [];
  if (headers.length > maxArrayElements) {
    throw new ExecutionLimitError(
      `xan: CSV column limit exceeded (${maxArrayElements})`,
      "array_elements",
    );
  }
  let cellCount = 0;
  let limitError: ExecutionLimitError | undefined;
  Papa.parse<Record<string, unknown>>(normalizedInput, {
    header: true,
    dynamicTyping: true,
    skipEmptyLines: true,
    step: (result, parser) => {
      const fields = Object.keys(result.data);
      if (safeData.length === 0 && result.meta.fields) {
        if (result.meta.fields.length > maxArrayElements) {
          limitError = new ExecutionLimitError(
            `xan: CSV column limit exceeded (${maxArrayElements})`,
            "array_elements",
          );
          parser.abort();
          return;
        }
        headers = [...result.meta.fields];
      }
      if (safeData.length >= maxRows || fields.length > maxCells - cellCount) {
        limitError = new ExecutionLimitError(
          safeData.length >= maxRows
            ? `xan: CSV row limit exceeded (${maxRows})`
            : `xan: CSV cell limit exceeded (${maxCells})`,
          "array_elements",
        );
        parser.abort();
        return;
      }
      cellCount += fields.length;
      safeData.push(toSafeRow(result.data));
    },
  });
  if (limitError) throw limitError;
  return { headers, data: safeData };
}

/** Parse headerless/ragged CSV incrementally while enforcing aggregate limits. */
export function parseCsvRows(
  input: string,
  limits: CsvParseLimits = {},
): CsvCells {
  const maxStringLength = limits.maxStringLength ?? 10 * 1024 * 1024;
  const maxArrayElements = limits.maxArrayElements ?? 100_000;
  const maxRows = limits.maxRows ?? maxArrayElements;
  const maxCells = limits.maxCells ?? 10_000_000;
  if (utf8ByteLength(input) > maxStringLength) {
    throw new ExecutionLimitError(
      `xan: CSV input size limit exceeded (${maxStringLength} bytes)`,
      "string_length",
    );
  }

  const rows: CsvCells = [];
  let cells = 0;
  let limitError: ExecutionLimitError | undefined;
  Papa.parse<Array<string | number | boolean | null>>(input.trim(), {
    header: false,
    dynamicTyping: false,
    skipEmptyLines: true,
    step: (result, parser) => {
      const row = result.data;
      if (
        rows.length >= maxRows ||
        row.length > maxArrayElements ||
        row.length > maxCells - cells
      ) {
        limitError = new ExecutionLimitError(
          rows.length >= maxRows
            ? `xan: CSV row limit exceeded (${maxRows})`
            : row.length > maxArrayElements
              ? `xan: CSV column limit exceeded (${maxArrayElements})`
              : `xan: CSV cell limit exceeded (${maxCells})`,
          "array_elements",
        );
        parser.abort();
        return;
      }
      cells += row.length;
      rows.push(row);
    },
  });
  if (limitError) throw limitError;
  return rows;
}

/** Format array of row objects back to CSV string */
export function formatCsv(
  headers: string[],
  data: CsvData,
  ctx?: CommandContext,
): string {
  return formatCsvValues(
    data.length,
    headers.length,
    (row, column) => data[row][headers[column]],
    ctx,
    headers,
  );
}

/** Format object rows in header order, omitting the header record itself. */
export function formatCsvWithoutHeaders(
  headers: string[],
  data: CsvData,
  ctx: CommandContext,
): string {
  return formatCsvValues(
    data.length,
    headers.length,
    (row, column) => data[row][headers[column]],
    ctx,
  );
}

/** Format already-materialized cells without Papa.unparse's unbounded copy. */
export function formatCsvRows(
  data: readonly (readonly unknown[])[],
  ctx?: CommandContext,
  headers?: readonly unknown[],
): string {
  return formatCsvValues(
    data.length,
    undefined,
    (row, column) => data[row][column],
    ctx,
    headers,
    (row) => data[row].length,
  );
}

function formatCsvValues(
  rowCount: number,
  columnCount: number | undefined,
  valueAt: (row: number, column: number) => unknown,
  ctx?: CommandContext,
  headers?: readonly unknown[],
  columnsAt: (row: number) => number = () => columnCount ?? 0,
): string {
  const maxBytes = ctx?.limits.maxOutputSize ?? Number.MAX_SAFE_INTEGER;
  const output = new BoundedStringBuilder(
    maxBytes,
    "xan CSV output",
    ctx
      ? () =>
          new ExecutionLimitError(
            `xan: output size limit exceeded (${maxBytes} bytes)`,
            "output_size",
          )
      : undefined,
  );

  const appendCell = (value: unknown): void => {
    const raw = value === null || value === undefined ? "" : String(value);
    let quoteCount = 0;
    for (let index = 0; index < raw.length; index++) {
      if (raw.charCodeAt(index) === 34) quoteCount++;
    }
    const needsQuotes =
      quoteCount > 0 ||
      raw.includes("\r") ||
      raw.includes("\n") ||
      raw.includes(",") ||
      raw.includes("\uFEFF") ||
      raw.startsWith(" ") ||
      raw.endsWith(" ");
    // Prove quote replacement fits before replace() can expand the cell.
    output.reserve(
      checkedAdd(
        utf8ByteLength(raw),
        checkedAdd(quoteCount, needsQuotes ? 2 : 0, "xan CSV output"),
        "xan CSV output",
      ),
    );
    const escaped = quoteCount > 0 ? raw.replace(/"/g, '""') : raw;
    output.append(needsQuotes ? `"${escaped}"` : escaped);
  };
  const appendRow = (row: number, columns: number): void => {
    for (let index = 0; index < columns; index++) {
      if (index > 0) output.append(",");
      appendCell(valueAt(row, index));
    }
    output.append("\n");
  };

  if (headers) {
    for (let index = 0; index < headers.length; index++) {
      if (index > 0) output.append(",");
      appendCell(headers[index]);
    }
    output.append("\n");
  }
  for (let row = 0; row < rowCount; row++) {
    ctx?.executionScope?.throwIfAborted("xan CSV output");
    appendRow(row, columnCount ?? columnsAt(row));
  }
  return output.build();
}

/** Read CSV input from file or stdin */
export async function readCsvInput(
  args: string[],
  ctx: CommandContext,
): Promise<{ headers: string[]; data: CsvData; error?: ExecResult }> {
  const file = args.find((a) => !a.startsWith("-"));
  let input: string;

  // CSV is text; decode bytes so multibyte fields aren't split mid-codepoint.
  if (!file || file === "-") {
    input = decodeBytesToUtf8(ctx.stdin);
  } else {
    try {
      const path = ctx.fs.resolvePath(ctx.cwd, file);
      input = await ctx.fs.readFile(path);
    } catch (error) {
      rethrowFatalExecutionError(error);
      return {
        headers: [],
        data: [],
        error: {
          stdout: "",
          stderr: `xan: ${file}: No such file or directory\n`,
          exitCode: 1,
        },
      };
    }
  }

  const { headers, data } = parseCsv(input, {
    maxStringLength: Math.min(
      ctx.limits.maxInputBytes,
      ctx.limits.maxStringLength,
    ),
    maxArrayElements: ctx.limits.maxArrayElements,
    maxRows: ctx.limits.maxCsvRows,
    maxCells: ctx.limits.maxCsvCells,
  });
  return { headers, data };
}
