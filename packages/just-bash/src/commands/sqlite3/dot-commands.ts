/**
 * Dot-command preprocessor for sqlite3.
 *
 * Real sqlite3's CLI accepts dot-commands (`.tables`, `.schema`, `.mode csv`,
 * `.read script.sql`, etc.) interleaved with SQL. The sql.js engine doesn't
 * implement these — they're a feature of the CLI, not the library — so we
 * translate them to equivalent SQL or to formatter mutations before handing
 * the script to the worker.
 *
 * Supported:
 *   .tables [pattern]           -> SELECT name FROM sqlite_master ...
 *   .schema [pattern]           -> SELECT sql FROM sqlite_master ...
 *   .indexes [pattern]          -> SELECT name FROM sqlite_master WHERE type='index' ...
 *   .databases                  -> emits a synthetic "main" row (sql.js has no ATTACH-to-file)
 *   .headers on|off             -> formatter mutation
 *   .header  on|off             -> alias of .headers
 *   .mode <mode>                -> formatter mutation (list|csv|json|line|column|table|markdown|tabs|box|quote|html|ascii)
 *   .separator <col> [<row>]    -> formatter mutation
 *   .nullvalue <text>           -> formatter mutation
 *   .read <file>                -> inline file contents (recursive, max depth 8)
 *   .quit / .exit               -> stop processing further input (best-effort)
 *
 * Not supported (returns an error so an agent sees a clear signal):
 *   .import .dump .clone .save .restore .backup .open .shell .system .iotrace
 *
 * Limitation: formatter mutations are global within a single sqlite3
 * invocation. The LAST seen `.mode` / `.headers` / `.separator` wins.
 * Real sqlite3 applies them incrementally; we approximate. This matches
 * the most common agent use case (`.mode csv` followed by SELECTs).
 */

import { sanitizeErrorMessage } from "../../fs/sanitize-error.js";
import type { CommandContext } from "../../types.js";
import type { OutputMode } from "./formatters.js";

const VALID_MODES: ReadonlySet<string> = new Set([
  "list",
  "csv",
  "json",
  "line",
  "column",
  "table",
  "markdown",
  "tabs",
  "box",
  "quote",
  "html",
  "ascii",
]);

const UNSUPPORTED_DOT_COMMANDS: ReadonlySet<string> = new Set([
  ".import",
  ".dump",
  ".clone",
  ".save",
  ".restore",
  ".backup",
  ".open",
  ".shell",
  ".system",
  ".iotrace",
  ".log",
  ".cd",
  ".load",
  ".excel",
]);

const MAX_READ_DEPTH = 8;

export interface FormatterMutation {
  mode?: OutputMode;
  header?: boolean;
  separator?: string;
  newline?: string;
  nullValue?: string;
}

export interface PreprocessResult {
  /** SQL with dot-commands replaced by their SQL equivalents. */
  sql: string;
  /** Accumulated formatter mutation (last-write-wins). */
  formatterMutation: FormatterMutation;
  /** First error encountered, if any. */
  error?: string;
  /** Set when .quit/.exit was encountered; everything after is dropped. */
  quit?: true;
}

interface PreprocessCtx {
  fs: CommandContext["fs"];
  cwd: string;
  /** Recursion depth tracker for .read. */
  depth: number;
}

/**
 * Tokenize a dot-command line into [name, ...args]. Single- and double-quoted
 * args are honored; everything else is whitespace-separated. Backslash escapes
 * are not honored — bash already processed them by the time we see this.
 */
function tokenizeDotCommand(line: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inQuote: '"' | "'" | null = null;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuote) {
      if (ch === inQuote) {
        inQuote = null;
      } else {
        current += ch;
      }
    } else if (ch === '"' || ch === "'") {
      inQuote = ch;
    } else if (ch === " " || ch === "\t") {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }
  if (current.length > 0) tokens.push(current);
  return tokens;
}

function escapeSqlLiteral(s: string): string {
  return s.replace(/'/g, "''");
}

/**
 * Translate a single dot-command to SQL or a formatter mutation.
 * Returns the SQL replacement (may be empty string for pure mutations),
 * a quit signal (.quit/.exit, possibly with trailing SQL from .read),
 * or an error.
 */
async function translateDotCommand(
  tokens: string[],
  mutation: FormatterMutation,
  ctx: PreprocessCtx,
): Promise<{ sql: string; quit?: true } | { error: string }> {
  const [head, ...rest] = tokens;

  // The caller's guard (`/^\.[a-zA-Z]/`) ensures non-empty tokens in
  // practice, but make the assumption explicit so a future caller change
  // can't produce confusing "unknown command: undefined" errors.
  if (!head) {
    return { error: "Error: empty dot-command" };
  }

  if (UNSUPPORTED_DOT_COMMANDS.has(head)) {
    return {
      error: `Error: ${head} is not supported by just-bash sqlite3`,
    };
  }

  switch (head) {
    case ".tables": {
      const pat = rest[0];
      // Use '~' as ESCAPE char to avoid the JS-template-literal -> SQL
      // double-escape ambiguity that '\\' creates.
      const where = pat
        ? `type='table' AND name NOT LIKE 'sqlite~_%' ESCAPE '~' AND name LIKE '${escapeSqlLiteral(pat)}'`
        : `type='table' AND name NOT LIKE 'sqlite~_%' ESCAPE '~'`;
      return {
        sql: `SELECT name FROM sqlite_master WHERE ${where} ORDER BY name`,
      };
    }
    case ".indexes":
    case ".indices": {
      const pat = rest[0];
      const where = pat
        ? `type='index' AND tbl_name LIKE '${escapeSqlLiteral(pat)}'`
        : `type='index'`;
      return {
        sql: `SELECT name FROM sqlite_master WHERE ${where} ORDER BY name`,
      };
    }
    case ".schema": {
      const pat = rest[0];
      const where = pat
        ? `type IN ('table','index','view','trigger') AND sql IS NOT NULL AND name LIKE '${escapeSqlLiteral(pat)}'`
        : `type IN ('table','index','view','trigger') AND sql IS NOT NULL`;
      // Append ';' so output mirrors real sqlite3 .schema (each CREATE ends with ;)
      return {
        sql: `SELECT sql || ';' FROM sqlite_master WHERE ${where} ORDER BY name`,
      };
    }
    case ".databases": {
      // sql.js sandbox: only "main" is meaningful. Emit a synthetic single row.
      return {
        sql: `SELECT 'main' AS name, '' AS file`,
      };
    }
    case ".headers":
    case ".header": {
      const v = rest[0]?.toLowerCase();
      if (v === "on" || v === "true" || v === "1") {
        mutation.header = true;
      } else if (v === "off" || v === "false" || v === "0") {
        mutation.header = false;
      } else {
        return {
          error: `Error: unknown argument to ${head}: ${rest[0] ?? ""}`,
        };
      }
      return { sql: "" };
    }
    case ".mode": {
      const m = rest[0];
      if (!m || !VALID_MODES.has(m)) {
        return { error: `Error: unknown mode: ${m ?? ""}` };
      }
      mutation.mode = m as OutputMode;
      // Do NOT touch mutation.separator here — real sqlite3 keeps .separator
      // independent of .mode (csv/tabs hardcode their separators in the
      // formatter; list reads from options.separator). Mutating separator
      // here would clobber an explicit .separator that ran earlier.
      return { sql: "" };
    }
    case ".separator": {
      if (rest.length === 0) {
        return { error: "Error: .separator requires an argument" };
      }
      mutation.separator = rest[0];
      if (rest.length > 1) mutation.newline = rest[1];
      return { sql: "" };
    }
    case ".nullvalue": {
      mutation.nullValue = rest[0] ?? "";
      return { sql: "" };
    }
    case ".read": {
      const file = rest[0];
      if (!file) return { error: "Error: .read requires a filename" };
      if (ctx.depth >= MAX_READ_DEPTH) {
        return { error: "Error: .read depth limit exceeded" };
      }
      let contents: string;
      try {
        const path = ctx.fs.resolvePath(ctx.cwd, file);
        contents = await ctx.fs.readFile(path);
      } catch (e) {
        return {
          error: `Error: cannot open ${file}: ${sanitizeErrorMessage((e as Error).message)}`,
        };
      }
      // Recurse so .read inside the file is also expanded
      const sub = await preprocessDotCommandsInternal(contents, mutation, {
        fs: ctx.fs,
        cwd: ctx.cwd,
        depth: ctx.depth + 1,
      });
      if (sub.error) return { error: sub.error };
      // Propagate the quit signal: a .quit inside the read'd file should
      // stop the parent from processing anything that came after .read.
      return sub.quit ? { sql: sub.sql, quit: true } : { sql: sub.sql };
    }
    case ".quit":
    case ".exit": {
      // Stop processing further input. Real sqlite3 exits immediately on
      // .quit; we approximate by dropping everything that follows from
      // the SQL we emit to the worker.
      return { sql: "", quit: true };
    }
    case ".help":
    case ".show":
    case ".timer":
    case ".changes":
    case ".bail":
    case ".echo":
    case ".eqp":
    case ".width":
    case ".prompt":
    case ".print":
    case ".explain":
      // Accept silently; not implemented but harmless to ignore for agent use.
      return { sql: "" };
    default:
      return {
        error: `Error: unknown command or invalid arguments: "${head.replace(/^\./, "")}". Enter ".help" for help`,
      };
  }
}

async function preprocessDotCommandsInternal(
  input: string,
  mutation: FormatterMutation,
  ctx: PreprocessCtx,
): Promise<PreprocessResult> {
  const lines = input.split("\n");
  const outLines: string[] = [];

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    // Only treat lines starting with `.` followed by a letter as
    // dot-commands. SQL line comments (`-- ...`) and SQL fragments that
    // happen to start with `.` followed by a digit (e.g. a numeric
    // continuation `.5`) are passed through unchanged.
    if (
      trimmed.startsWith("--") ||
      !trimmed.startsWith(".") ||
      !/^\.[a-zA-Z]/.test(trimmed)
    ) {
      outLines.push(rawLine);
      continue;
    }
    const tokens = tokenizeDotCommand(trimmed);
    const result = await translateDotCommand(tokens, mutation, ctx);
    if ("error" in result) {
      return {
        sql: outLines.join("\n"),
        formatterMutation: mutation,
        error: result.error,
      };
    }
    if (result.sql.length > 0) {
      // Ensure dot-translated SQL is its own statement. .read produces
      // multi-line output; split so each line becomes its own outLines
      // entry rather than a single multi-line element (keeps the
      // outLines.join("\n") at the end behaving uniformly).
      const stmt = result.sql.trim();
      const withSemi = stmt.endsWith(";") ? stmt : `${stmt};`;
      for (const line of withSemi.split("\n")) {
        outLines.push(line);
      }
    }
    if (result.quit) {
      return {
        sql: outLines.join("\n"),
        formatterMutation: mutation,
        quit: true,
      };
    }
  }

  return { sql: outLines.join("\n"), formatterMutation: mutation };
}

/**
 * Public entry point. Walks the SQL line by line, replacing dot-commands
 * with equivalent SQL or formatter mutations. Returns the rewritten SQL
 * plus the accumulated mutation to apply to FormatOptions.
 */
export async function preprocessDotCommands(
  sql: string,
  ctx: { fs: CommandContext["fs"]; cwd: string },
): Promise<PreprocessResult> {
  const mutation: FormatterMutation = Object.create(null);
  return preprocessDotCommandsInternal(sql, mutation, {
    fs: ctx.fs,
    cwd: ctx.cwd,
    depth: 0,
  });
}
