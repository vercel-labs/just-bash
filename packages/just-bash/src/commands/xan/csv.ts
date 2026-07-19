/**
 * CSV parsing and formatting utilities for xan command
 */

import Papa from "papaparse";
import { decodeBytesToUtf8 } from "../../encoding.js";
import { ExecutionLimitError } from "../../interpreter/errors.js";
import type { CommandContext, ExecResult } from "../../types.js";
import { utf8ByteLength } from "../printf/escapes.js";

export interface CsvRow {
  [key: string]: string | number | boolean | null;
}

export type CsvData = CsvRow[];

export interface CsvParseLimits {
  maxStringLength?: number;
  maxArrayElements?: number;
  maxRows?: number;
  maxCells?: number;
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

/** Format array of row objects back to CSV string */
export function formatCsv(headers: string[], data: CsvData): string {
  if (data.length === 0) {
    return `${headers.join(",")}\n`;
  }
  // papaparse may produce \r\n, normalize to \n
  const csv = Papa.unparse(data, { columns: headers });
  return `${csv.replace(/\r\n/g, "\n")}\n`;
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
    } catch {
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
