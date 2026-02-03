/**
 * CSV parsing and formatting utilities for xan command
 */

import Papa from "papaparse";
import type { CommandContext, ExecResult } from "../../types.js";

export interface CsvRow {
  [key: string]: string | number | boolean | null;
}

export type CsvData = CsvRow[];

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
export function parseCsv(input: string): { headers: string[]; data: CsvData } {
  const result = Papa.parse<CsvRow>(input.trim(), {
    header: true,
    dynamicTyping: true,
    skipEmptyLines: true,
  });
  // Convert each row to a null-prototype object to prevent prototype pollution
  const safeData = result.data.map((row) =>
    toSafeRow(row as Record<string, unknown>),
  );
  return {
    headers: result.meta.fields || [],
    data: safeData,
  };
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

  if (!file || file === "-") {
    input = ctx.stdin;
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

  const { headers, data } = parseCsv(input);
  return { headers, data };
}
