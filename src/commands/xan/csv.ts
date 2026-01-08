/**
 * CSV parsing and formatting utilities for xan command
 */

import Papa from "papaparse";
import type { CommandContext, ExecResult } from "../../types.js";

export interface CsvRow {
  [key: string]: string | number | boolean | null;
}

export type CsvData = CsvRow[];

/** Parse CSV input string to array of row objects */
function parseCsv(input: string): { headers: string[]; data: CsvData } {
  const result = Papa.parse<CsvRow>(input.trim(), {
    header: true,
    dynamicTyping: true,
    skipEmptyLines: true,
  });
  return {
    headers: result.meta.fields || [],
    data: result.data,
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
