/**
 * View commands: pretty print CSV as table or flattened records
 */

import type { CommandContext, ExecResult } from "../../types.js";
import { readCsvInput } from "./csv.js";

/**
 * Flatten: display records vertically, one field per line
 * Usage: xan flatten [OPTIONS] [FILE]
 *   -l, --limit N    Maximum number of rows to display
 *   -s, --select COLS  Select columns to display
 */
export async function cmdFlatten(
  args: string[],
  ctx: CommandContext,
): Promise<ExecResult> {
  let limit = 0; // 0 means all rows
  let selectCols: string[] = [];
  const fileArgs: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if ((arg === "-l" || arg === "--limit") && i + 1 < args.length) {
      limit = Number.parseInt(args[++i], 10);
    } else if ((arg === "-s" || arg === "--select") && i + 1 < args.length) {
      selectCols = args[++i].split(",");
    } else if (!arg.startsWith("-")) {
      fileArgs.push(arg);
    }
  }

  const { headers, data, error } = await readCsvInput(fileArgs, ctx);
  if (error) return error;

  const displayHeaders =
    selectCols.length > 0
      ? selectCols.filter((c) => headers.includes(c))
      : headers;

  const rows = limit > 0 ? data.slice(0, limit) : data;

  // Calculate max header width for alignment
  const maxHeaderWidth = Math.max(...displayHeaders.map((h) => h.length));

  // Build output
  const lines: string[] = [];
  const separator = "─".repeat(80);

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    lines.push(`Row n°${i}`);
    lines.push(separator);

    for (const h of displayHeaders) {
      const val = row[h];
      const valStr = val === null || val === undefined ? "" : String(val);
      lines.push(`${h.padEnd(maxHeaderWidth)} ${valStr}`);
    }

    if (i < rows.length - 1) {
      lines.push(""); // Empty line between records
    }
  }

  return { stdout: `${lines.join("\n")}\n`, stderr: "", exitCode: 0 };
}

export async function cmdView(
  args: string[],
  ctx: CommandContext,
): Promise<ExecResult> {
  let n = 0; // 0 means all rows
  const fileArgs: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-n" && i + 1 < args.length) {
      n = Number.parseInt(args[++i], 10);
    } else if (!arg.startsWith("-")) {
      fileArgs.push(arg);
    }
  }

  const { headers, data, error } = await readCsvInput(fileArgs, ctx);
  if (error) return error;

  const rows = n > 0 ? data.slice(0, n) : data;

  // Calculate column widths
  const widths = headers.map((h) => h.length);
  for (const row of rows) {
    for (let i = 0; i < headers.length; i++) {
      const val = String(row[headers[i]] ?? "");
      widths[i] = Math.max(widths[i], val.length);
    }
  }

  // Build table
  const lines: string[] = [];
  const border = "─";
  const sep = "│";

  // Top border
  lines.push(`┌${widths.map((w) => border.repeat(w + 2)).join("┬")}┐`);

  // Header
  const headerRow = headers.map((h, i) => ` ${h.padEnd(widths[i])} `).join(sep);
  lines.push(`${sep}${headerRow}${sep}`);

  // Header separator
  lines.push(`├${widths.map((w) => border.repeat(w + 2)).join("┼")}┤`);

  // Data rows
  for (const row of rows) {
    const dataRow = headers
      .map((h, i) => ` ${String(row[h] ?? "").padEnd(widths[i])} `)
      .join(sep);
    lines.push(`${sep}${dataRow}${sep}`);
  }

  // Bottom border
  lines.push(`└${widths.map((w) => border.repeat(w + 2)).join("┴")}┘`);

  return { stdout: `${lines.join("\n")}\n`, stderr: "", exitCode: 0 };
}
