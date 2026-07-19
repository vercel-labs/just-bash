/**
 * View commands: pretty print CSV as table or flattened records
 */

import type { CommandContext, ExecResult } from "../../types.js";
import { XanOutputBuilder } from "./bounded-output.js";
import { readCsvInput } from "./csv.js";

function outputLimit(ctx: CommandContext): number {
  return Math.min(ctx.limits.maxStringLength, ctx.limits.maxOutputSize);
}

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
  let maxHeaderWidth = 0;
  for (const header of displayHeaders) {
    maxHeaderWidth = Math.max(maxHeaderWidth, header.length);
  }

  const output = new XanOutputBuilder(outputLimit(ctx));

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    output.append(`Row n°${i}\n`);
    output.repeat("─", 80);
    output.append("\n");

    for (const h of displayHeaders) {
      const val = row[h];
      const valStr = val === null || val === undefined ? "" : String(val);
      output.append(h);
      output.repeat(" ", maxHeaderWidth - h.length + 1);
      output.append(`${valStr}\n`);
    }

    if (i < rows.length - 1) {
      output.append("\n");
    }
  }

  return { stdout: output.build(), stderr: "", exitCode: 0 };
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

  const output = new XanOutputBuilder(outputLimit(ctx));
  const border = "─";
  const sep = "│";

  // Top border
  output.append("┌");
  for (let i = 0; i < widths.length; i++) {
    if (i > 0) output.append("┬");
    output.repeat(border, widths[i] + 2);
  }
  output.append("┐\n");

  // Header
  output.append(sep);
  for (let i = 0; i < headers.length; i++) {
    if (i > 0) output.append(sep);
    output.append(` ${headers[i]}`);
    output.repeat(" ", widths[i] - headers[i].length + 1);
  }
  output.append(`${sep}\n`);

  // Header separator
  output.append("├");
  for (let i = 0; i < widths.length; i++) {
    if (i > 0) output.append("┼");
    output.repeat(border, widths[i] + 2);
  }
  output.append("┤\n");

  // Data rows
  for (const row of rows) {
    output.append(sep);
    for (let i = 0; i < headers.length; i++) {
      if (i > 0) output.append(sep);
      const value = String(row[headers[i]] ?? "");
      output.append(` ${value}`);
      output.repeat(" ", widths[i] - value.length + 1);
    }
    output.append(`${sep}\n`);
  }

  // Bottom border
  output.append("└");
  for (let i = 0; i < widths.length; i++) {
    if (i > 0) output.append("┴");
    output.repeat(border, widths[i] + 2);
  }
  output.append("┘\n");

  return { stdout: output.build(), stderr: "", exitCode: 0 };
}
