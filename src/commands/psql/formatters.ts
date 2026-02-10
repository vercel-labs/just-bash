/**
 * Output formatters for psql command
 */

import type { PsqlOptions } from "./parser.js";

/**
 * Format query results based on output options
 */
export function formatResults(
  columns: string[],
  rows: unknown[][],
  options: PsqlOptions,
): string {
  if (rows.length === 0 && options.tuplesOnly) {
    return "";
  }

  switch (options.outputFormat) {
    case "aligned":
      return formatAligned(columns, rows, options);
    case "unaligned":
      return formatUnaligned(columns, rows, options);
    case "csv":
      return formatCsv(columns, rows, options);
    case "json":
      return formatJson(columns, rows);
    case "html":
      return formatHtml(columns, rows, options);
    default:
      return formatAligned(columns, rows, options);
  }
}

/**
 * Format as aligned table (default psql output)
 */
function formatAligned(
  columns: string[],
  rows: unknown[][],
  options: PsqlOptions,
): string {
  if (columns.length === 0) return "";

  const widths = columns.map((col, i) => {
    const maxDataWidth = Math.max(
      ...rows.map((row) => String(row[i] ?? "").length),
    );
    return Math.max(col.length, maxDataWidth);
  });

  let output = "";

  // Header
  if (!options.tuplesOnly) {
    output +=
      columns.map((col, i) => col.padEnd(widths[i])).join(" | ") +
      options.recordSeparator;

    // Separator line
    output +=
      widths.map((w) => "-".repeat(w)).join("-+-") + options.recordSeparator;
  }

  // Rows
  for (const row of rows) {
    output +=
      row.map((val, i) => String(val ?? "").padEnd(widths[i])).join(" | ") +
      options.recordSeparator;
  }

  // Footer with row count
  if (!options.tuplesOnly && !options.quiet) {
    const rowText = rows.length === 1 ? "row" : "rows";
    output += `(${rows.length} ${rowText})${options.recordSeparator}`;
  }

  return output;
}

/**
 * Format as unaligned output (field separator delimited)
 */
function formatUnaligned(
  columns: string[],
  rows: unknown[][],
  options: PsqlOptions,
): string {
  let output = "";

  // Header
  if (!options.tuplesOnly) {
    output += columns.join(options.fieldSeparator) + options.recordSeparator;
  }

  // Rows
  for (const row of rows) {
    output +=
      row.map((val) => String(val ?? "")).join(options.fieldSeparator) +
      options.recordSeparator;
  }

  return output;
}

/**
 * Format as CSV
 */
function formatCsv(
  columns: string[],
  rows: unknown[][],
  options: PsqlOptions,
): string {
  let output = "";

  // Header
  if (!options.tuplesOnly) {
    output += columns.map(escapeCsv).join(",") + options.recordSeparator;
  }

  // Rows
  for (const row of rows) {
    output +=
      row.map((val) => escapeCsv(String(val ?? ""))).join(",") +
      options.recordSeparator;
  }

  return output;
}

/**
 * Escape CSV field (add quotes if needed)
 */
function escapeCsv(field: string): string {
  if (
    field.includes(",") ||
    field.includes('"') ||
    field.includes("\n") ||
    field.includes("\r")
  ) {
    return `"${field.replace(/"/g, '""')}"`;
  }
  return field;
}

/**
 * Format as JSON array of objects
 */
function formatJson(columns: string[], rows: unknown[][]): string {
  const objects = rows.map((row) => {
    const obj: Record<string, unknown> = {};
    for (let i = 0; i < columns.length; i++) {
      obj[columns[i]] = row[i];
    }
    return obj;
  });

  return `${JSON.stringify(objects, null, 2)}\n`;
}

/**
 * Format as HTML table
 */
function formatHtml(
  columns: string[],
  rows: unknown[][],
  options: PsqlOptions,
): string {
  let output = "<table>\n";

  // Header
  if (!options.tuplesOnly) {
    output += "  <thead>\n    <tr>\n";
    for (const col of columns) {
      output += `      <th>${escapeHtml(col)}</th>\n`;
    }
    output += "    </tr>\n  </thead>\n";
  }

  // Body
  output += "  <tbody>\n";
  for (const row of rows) {
    output += "    <tr>\n";
    for (const val of row) {
      output += `      <td>${escapeHtml(String(val ?? ""))}</td>\n`;
    }
    output += "    </tr>\n";
  }
  output += "  </tbody>\n";

  output += "</table>\n";
  return output;
}

/**
 * Escape HTML entities
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
