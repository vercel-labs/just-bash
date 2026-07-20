/**
 * Output formatters for sqlite3 command
 */

export type OutputMode =
  | "list"
  | "csv"
  | "json"
  | "line"
  | "column"
  | "table"
  | "markdown"
  | "tabs"
  | "box"
  | "quote"
  | "html"
  | "ascii";

export interface FormatOptions {
  mode: OutputMode;
  header: boolean;
  separator: string;
  nullValue: string;
  newline: string;
  /** Maximum encoded output bytes produced by this formatting call. */
  maxOutputSize?: number;
}

function valueInputByteLength(value: unknown, nullValue: string): number {
  if (value === null || value === undefined)
    return Buffer.byteLength(nullValue, "utf8");
  if (value instanceof Uint8Array || Buffer.isBuffer(value))
    return value.byteLength;
  return Buffer.byteLength(String(value), "utf8");
}

function assertFormattingBudget(
  columns: string[],
  rows: unknown[][],
  options: FormatOptions,
): number {
  const limit = options.maxOutputSize ?? Number.MAX_SAFE_INTEGER;
  let inputBytes = Buffer.byteLength(options.separator, "utf8");
  inputBytes += Buffer.byteLength(options.newline, "utf8");
  for (const column of columns) inputBytes += Buffer.byteLength(column, "utf8");
  for (const row of rows) {
    inputBytes += row.length * 16;
    for (const value of row)
      inputBytes += valueInputByteLength(value, options.nullValue);
    if (inputBytes > limit) break;
  }

  // JSON, HTML and quoting can expand every input byte. Eight times the raw
  // payload plus structural overhead is a deliberately conservative ceiling,
  // checked before padEnd/repeat/map/join allocate formatted copies.
  const worstCase =
    inputBytes * 8 + (rows.length + 3) * (columns.length + 3) * 16;
  if (!Number.isSafeInteger(worstCase) || worstCase > limit) {
    throw new Error(`formatted output exceeds ${limit} byte limit`);
  }
  return limit;
}

/**
 * Format query results according to the specified options
 */
export function formatOutput(
  columns: string[],
  rows: unknown[][],
  options: FormatOptions,
): string {
  const limit = assertFormattingBudget(columns, rows, options);
  let output: string;
  switch (options.mode) {
    case "list":
      output = formatList(columns, rows, options);
      break;
    case "csv":
      output = formatCsv(columns, rows, options);
      break;
    case "json":
      output = formatJson(columns, rows);
      break;
    case "line":
      output = formatLine(columns, rows, options);
      break;
    case "column":
      output = formatColumn(columns, rows, options);
      break;
    case "table":
      output = formatTable(columns, rows, options);
      break;
    case "markdown":
      output = formatMarkdown(columns, rows, options);
      break;
    case "tabs":
      output = formatTabs(columns, rows, options);
      break;
    case "box":
      output = formatBox(columns, rows, options);
      break;
    case "quote":
      output = formatQuote(columns, rows, options);
      break;
    case "html":
      output = formatHtml(columns, rows, options);
      break;
    case "ascii":
      output = formatAscii(columns, rows, options);
      break;
  }
  if (Buffer.byteLength(output, "utf8") > limit)
    throw new Error(`formatted output exceeds ${limit} byte limit`);
  return output;
}

function valueToString(value: unknown, nullValue: string): string {
  if (value === null || value === undefined) return nullValue;
  if (value instanceof Uint8Array || Buffer.isBuffer(value)) {
    // Real sqlite3 outputs BLOB as decoded text
    return Buffer.from(value as Uint8Array).toString("utf8");
  }
  // Real sqlite3 outputs full IEEE 754 precision for floats
  if (typeof value === "number" && !Number.isInteger(value)) {
    return value.toPrecision(17).replace(/\.?0+$/, "");
  }
  return String(value);
}

/**
 * List mode: pipe-separated values (default)
 */
function formatList(
  columns: string[],
  rows: unknown[][],
  options: FormatOptions,
): string {
  const lines: string[] = [];
  if (options.header && columns.length > 0) {
    lines.push(columns.join(options.separator));
  }
  for (const row of rows) {
    lines.push(
      row
        .map((v) => valueToString(v, options.nullValue))
        .join(options.separator),
    );
  }
  return lines.length > 0
    ? `${lines.join(options.newline)}${options.newline}`
    : "";
}

/**
 * CSV mode: proper CSV escaping
 */
function formatCsv(
  columns: string[],
  rows: unknown[][],
  options: FormatOptions,
): string {
  const lines: string[] = [];
  if (options.header && columns.length > 0) {
    lines.push(columns.map(escapeCsvField).join(","));
  }
  for (const row of rows) {
    lines.push(
      row
        .map((v) => escapeCsvField(valueToString(v, options.nullValue)))
        .join(","),
    );
  }
  return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}

function escapeCsvField(value: string): string {
  // Real sqlite3 wraps in double quotes if value contains comma, quote, newline, or single quote
  if (
    value.includes(",") ||
    value.includes('"') ||
    value.includes("'") ||
    value.includes("\n")
  ) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Convert float to full precision string (matching real sqlite3)
 */
function floatToFullPrecision(value: number): string {
  return value.toPrecision(17).replace(/\.?0+$/, "");
}

/**
 * Convert value to JSON representation with full float precision
 */
function valueToJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "number") {
    if (Number.isInteger(value)) return String(value);
    return floatToFullPrecision(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  return JSON.stringify(value);
}

/**
 * JSON mode: array of objects
 */
function formatJson(columns: string[], rows: unknown[][]): string {
  if (rows.length === 0) return "";

  const objects = rows.map((row) => {
    const pairs = columns.map(
      (col, i) => `${JSON.stringify(col)}:${valueToJson(row[i])}`,
    );
    return `{${pairs.join(",")}}`;
  });

  return `[${objects.join(",\n")}]\n`;
}

/**
 * Line mode: column = value per line
 */
function formatLine(
  columns: string[],
  rows: unknown[][],
  options: FormatOptions,
): string {
  if (columns.length === 0 || rows.length === 0) return "";

  // Find max column name length for alignment, minimum 5 chars to match real sqlite3
  const maxColLen = Math.max(5, ...columns.map((c) => c.length));

  const lines: string[] = [];
  for (const row of rows) {
    for (let i = 0; i < columns.length; i++) {
      // Right-align column name
      const paddedCol = columns[i].padStart(maxColLen);
      lines.push(`${paddedCol} = ${valueToString(row[i], options.nullValue)}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Column mode: fixed-width columns
 */
function formatColumn(
  columns: string[],
  rows: unknown[][],
  options: FormatOptions,
): string {
  if (columns.length === 0) return "";

  const widths = columns.map((c) => c.length);
  for (const row of rows) {
    for (let i = 0; i < row.length; i++) {
      const len = valueToString(row[i], options.nullValue).length;
      if (len > widths[i]) widths[i] = len;
    }
  }

  const lines: string[] = [];
  if (options.header) {
    lines.push(columns.map((c, i) => c.padEnd(widths[i])).join("  "));
    lines.push(widths.map((w) => "-".repeat(w)).join("  "));
  }
  for (const row of rows) {
    lines.push(
      row
        .map((v, i) => valueToString(v, options.nullValue).padEnd(widths[i]))
        .join("  "),
    );
  }
  return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}

/**
 * Table mode: ASCII box drawing
 */
function formatTable(
  columns: string[],
  rows: unknown[][],
  options: FormatOptions,
): string {
  if (columns.length === 0) return "";

  const widths = columns.map((c) => c.length);
  for (const row of rows) {
    for (let i = 0; i < row.length; i++) {
      const len = valueToString(row[i], options.nullValue).length;
      if (len > widths[i]) widths[i] = len;
    }
  }

  const lines: string[] = [];
  const border = `+${widths.map((w) => "-".repeat(w + 2)).join("+")}+`;

  lines.push(border);
  if (options.header) {
    lines.push(`| ${columns.map((c, i) => c.padEnd(widths[i])).join(" | ")} |`);
    lines.push(border);
  }
  for (const row of rows) {
    lines.push(
      `| ${row.map((v, i) => valueToString(v, options.nullValue).padEnd(widths[i])).join(" | ")} |`,
    );
  }
  lines.push(border);
  return `${lines.join("\n")}\n`;
}

/**
 * Markdown mode: markdown table format
 */
function formatMarkdown(
  columns: string[],
  rows: unknown[][],
  options: FormatOptions,
): string {
  if (columns.length === 0) return "";

  const lines: string[] = [];
  if (options.header) {
    lines.push(`| ${columns.join(" | ")} |`);
    lines.push(`|${columns.map(() => "---").join("|")}|`);
  }
  for (const row of rows) {
    lines.push(
      `| ${row.map((v) => valueToString(v, options.nullValue)).join(" | ")} |`,
    );
  }
  return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}

/**
 * Tabs mode: tab-separated values
 */
function formatTabs(
  columns: string[],
  rows: unknown[][],
  options: FormatOptions,
): string {
  const lines: string[] = [];
  if (options.header && columns.length > 0) {
    lines.push(columns.join("\t"));
  }
  for (const row of rows) {
    lines.push(row.map((v) => valueToString(v, options.nullValue)).join("\t"));
  }
  return lines.length > 0
    ? `${lines.join(options.newline)}${options.newline}`
    : "";
}

/**
 * Box mode: Unicode box drawing (always shows headers)
 */
function formatBox(
  columns: string[],
  rows: unknown[][],
  options: FormatOptions,
): string {
  if (columns.length === 0) return "";

  const widths = columns.map((c) => c.length);
  for (const row of rows) {
    for (let i = 0; i < row.length; i++) {
      const len = valueToString(row[i], options.nullValue).length;
      if (len > widths[i]) widths[i] = len;
    }
  }

  const lines: string[] = [];
  // Top border
  lines.push(`┌${widths.map((w) => "─".repeat(w + 2)).join("┬")}┐`);
  // Header row
  lines.push(`│ ${columns.map((c, i) => c.padEnd(widths[i])).join(" │ ")} │`);
  // Header separator
  lines.push(`├${widths.map((w) => "─".repeat(w + 2)).join("┼")}┤`);
  // Data rows
  for (const row of rows) {
    lines.push(
      `│ ${row.map((v, i) => valueToString(v, options.nullValue).padEnd(widths[i])).join(" │ ")} │`,
    );
  }
  // Bottom border
  lines.push(`└${widths.map((w) => "─".repeat(w + 2)).join("┴")}┘`);
  return `${lines.join("\n")}\n`;
}

/**
 * Quote mode: SQL-style quoted values
 */
function formatQuote(
  columns: string[],
  rows: unknown[][],
  options: FormatOptions,
): string {
  const lines: string[] = [];
  if (options.header && columns.length > 0) {
    lines.push(columns.map(sqlQuoteLiteral).join(","));
  }
  for (const row of rows) {
    lines.push(row.map(sqlQuoteLiteral).join(","));
  }
  return lines.length > 0
    ? `${lines.join(options.newline)}${options.newline}`
    : "";
}

/** Serialize one SQLite value as a replay-safe SQL literal. */
function sqlQuoteLiteral(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (value instanceof Uint8Array || Buffer.isBuffer(value)) {
    return `X'${Buffer.from(value as Uint8Array)
      .toString("hex")
      .toUpperCase()}'`;
  }
  if (typeof value === "number") {
    if (Number.isInteger(value)) return String(value);
    if (Number.isFinite(value)) return floatToFullPrecision(value);
  }
  return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * HTML mode: HTML table rows
 */
function formatHtml(
  columns: string[],
  rows: unknown[][],
  options: FormatOptions,
): string {
  const lines: string[] = [];
  if (options.header && columns.length > 0) {
    lines.push(
      `<TR>${columns.map((c) => `<TH>${escapeHtml(c)}</TH>`).join("")}`,
    );
    lines.push("</TR>");
  }
  for (const row of rows) {
    lines.push(
      `<TR>${row.map((v) => `<TD>${escapeHtml(valueToString(v, options.nullValue))}</TD>`).join("")}`,
    );
    lines.push("</TR>");
  }
  return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * ASCII mode: ASCII control character separators
 * Uses 0x1F (Unit Separator) between columns and 0x1E (Record Separator) between rows
 */
function formatAscii(
  columns: string[],
  rows: unknown[][],
  options: FormatOptions,
): string {
  const colSep = String.fromCharCode(0x1f); // Unit Separator
  const rowSep = String.fromCharCode(0x1e); // Record Separator

  const lines: string[] = [];
  if (options.header && columns.length > 0) {
    lines.push(columns.join(colSep));
  }
  for (const row of rows) {
    lines.push(
      row.map((v) => valueToString(v, options.nullValue)).join(colSep),
    );
  }
  return lines.length > 0 ? lines.join(rowSep) + rowSep : "";
}
