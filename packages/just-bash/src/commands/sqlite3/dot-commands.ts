/**
 * Dot-command preprocessor for sqlite3.
 *
 * Real sqlite3's CLI accepts dot-commands (`.tables`, `.schema`, `.mode csv`,
 * `.read script.sql`, etc.) interleaved with SQL. The sql.js engine doesn't
 * implement these — they're a feature of the CLI, not the library — so we
 * translate them to equivalent SQL, mutate formatter state, recursively
 * inline `.read`'d files, or surface errors before handing the script to
 * the worker.
 *
 * Scanner: char-level, with state for SQL string literals (`'…'`, `"…"`
 * including the SQL doubled-quote escape `''` / `""`), line comments
 * (`-- …\n`), and block comments (`/* … *​/`). A dot-command is
 * recognized only at a "boundary" — start of input, just after a `;`,
 * or just after a `\n` — and only when not inside a string or comment.
 * This is what lets `'a\n.tables'` round-trip intact and what lets
 * `.headers on; .mode csv; CREATE TABLE…;` be three separate tokens
 * on a single line.
 *
 * Each recognized dot-command resolves to one of these outcomes:
 *
 *   1. SQL replacement — emit equivalent SQL in the dot-command's place.
 *      Used for: .tables, .schema, .indexes/.indices, .databases (sqlite_master
 *      queries / PRAGMA) and .help (a SELECT of the help text). Also used
 *      for the recursively-inlined contents of a successful `.read FILE`.
 *
 *   2. Formatter mutation — adjust output state for downstream SQL.
 *      Used for: .headers/.header (on/off), .mode <mode>, .separator <s>
 *      [<row>], .nullvalue <text>. Bad arguments surface a preprocessor
 *      error matching real sqlite3's wording (e.g. "Error: unknown mode:
 *      parquet"). Last write wins within a single invocation.
 *
 *   3. Silent drop — recognize and discard, surrounding SQL still runs.
 *      Used for the no-op metacommands the sandbox doesn't implement
 *      (.echo, .timer, .changes, .bail, .show, .eqp, .width, .prompt,
 *      .print, .explain).
 *
 *   4. .read FILE — open the file, recursively run the same scanner on
 *      its contents (sharing the formatter mutation and bumping depth),
 *      and splice the result into the output stream. Missing files,
 *      missing arguments, or exceeding MAX_READ_DEPTH surface a
 *      preprocessor error.
 *
 *   5. .quit / .exit — terminate preprocessing; anything after them is
 *      dropped (including in a parent scanner that called us through
 *      `.read`).
 *
 *   6. Not-implemented family — .dump, .save, .backup, .import, .clone,
 *      .restore, .open, .output, .shell, .system, .cd, .load, .iotrace,
 *      .log, .excel translate to a `SELECT 'Error: …' AS error;` so the
 *      message rides in stdout in script-order without aborting the
 *      surrounding SQL. We don't implement these, but agents reach for
 *      them and an actionable hint is friendlier than a syntax error.
 *
 *   7. Passthrough — unknown dot-commands are left in place verbatim,
 *      so sql.js produces its native "near \".\": syntax error" rather
 *      than us inventing a CLI-shaped error message.
 *
 * Pattern handling: `.tables PAT`, `.schema PAT`, `.indexes PAT` convert
 * shell-glob `*`/`?` to SQL `%`/`_` so `.tables user*` matches the way
 * agents expect.
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

const SILENT_DROP_COMMANDS: ReadonlySet<string> = new Set([
  ".echo",
  ".timer",
  ".changes",
  ".bail",
  ".show",
  ".eqp",
  ".width",
  ".prompt",
  ".print",
  ".explain",
]);

const MAX_READ_DEPTH = 8;

const HELP_TEXT =
  "Supported dot commands: .tables [PAT], .schema [PAT], .indexes [TBL] (alias .indices), .databases, .help. " +
  "Formatter state: .headers/.header on|off, .mode <list|csv|json|line|column|table|markdown|tabs|box|quote|html|ascii>, .separator <SEP> [<ROW>], .nullvalue <TEXT>. " +
  "File inlining: .read FILE (recursive). " +
  "Stops processing: .quit / .exit. " +
  "Silent no-ops: .echo / .timer / .changes / .bail / .show / .eqp / .width / .prompt / .print / .explain. " +
  "Not implemented: .dump / .save / .backup / .import / .clone / .restore / .open / .output / .shell / .system / .cd / .load / .iotrace / .log / .excel (each emits an actionable error). " +
  "Unknown commands fall through to sql.js for a native syntax error.";

export interface FormatterMutation {
  mode?: OutputMode;
  header?: boolean;
  separator?: string;
  newline?: string;
  nullValue?: string;
}

export interface PreprocessResult {
  /** SQL with dot-commands replaced by equivalent SQL or dropped. */
  sql: string;
  /** Accumulated formatter state from .mode / .headers / .separator / .nullvalue. */
  formatterMutation: FormatterMutation;
  /** First dot-command error encountered; preprocessing stops at that point. */
  error?: string;
  /** Set when .quit / .exit was encountered; everything after is dropped. */
  quit?: true;
}

interface PreprocessCtx {
  fs: CommandContext["fs"];
  cwd: string;
  /** Recursion depth tracker for .read. */
  depth: number;
}

type Translation =
  | { kind: "sql"; sql: string; quit?: boolean }
  | { kind: "drop" }
  | { kind: "passthrough" }
  | { kind: "quit" }
  | { kind: "error"; message: string };

/**
 * Tokenize a dot-command's argument tail into a list of strings. Single-
 * and double-quoted segments are honored and their quotes stripped so a
 * caller's `'order%'` becomes the bare argument `order%`. Anything else
 * splits on whitespace.
 */
function tokenizeArgs(tail: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inQuote: '"' | "'" | null = null;
  let hasContent = false;

  for (let i = 0; i < tail.length; i++) {
    const ch = tail[i];
    if (inQuote) {
      if (ch === inQuote) {
        inQuote = null;
      } else {
        current += ch;
        hasContent = true;
      }
    } else if (ch === '"' || ch === "'") {
      inQuote = ch;
      hasContent = true;
    } else if (ch === " " || ch === "\t" || ch === "\r") {
      if (hasContent) {
        tokens.push(current);
        current = "";
        hasContent = false;
      }
    } else {
      current += ch;
      hasContent = true;
    }
  }
  if (hasContent) tokens.push(current);
  return tokens;
}

function escapeSqlLiteral(s: string): string {
  return s.replace(/'/g, "''");
}

function sqlString(s: string): string {
  return `'${escapeSqlLiteral(s)}'`;
}

/**
 * Convert shell-style glob (`*`, `?`) to SQL LIKE wildcards (`%`, `_`).
 * Pre-existing `_` and `%` in the pattern pass through as SQL wildcards
 * (intentional — matches real sqlite3's dot-command pattern handling).
 */
function globToSqlLike(pat: string): string {
  return pat.replace(/\*/g, "%").replace(/\?/g, "_");
}

function notImplementedSelect(
  cmd: string,
  hint: string,
): { kind: "sql"; sql: string } {
  const msg = `Error: ${cmd} is not implemented in just-bash sqlite3 - ${hint}`;
  return { kind: "sql", sql: `SELECT ${sqlString(msg)} AS error;` };
}

async function translateDotCommand(
  cmd: string,
  args: string[],
  mutation: FormatterMutation,
  ctx: PreprocessCtx,
): Promise<Translation> {
  if (SILENT_DROP_COMMANDS.has(cmd)) {
    return { kind: "drop" };
  }

  switch (cmd) {
    case ".headers":
    case ".header": {
      const v = args[0]?.toLowerCase();
      if (v === "on" || v === "true" || v === "1") {
        mutation.header = true;
      } else if (v === "off" || v === "false" || v === "0") {
        mutation.header = false;
      } else {
        return {
          kind: "error",
          message: `Error: unknown argument to ${cmd}: ${args[0] ?? ""}`,
        };
      }
      return { kind: "drop" };
    }
    case ".mode": {
      const m = args[0];
      if (!m || !VALID_MODES.has(m)) {
        return {
          kind: "error",
          message: `Error: unknown mode: ${m ?? ""}`,
        };
      }
      mutation.mode = m as OutputMode;
      // Don't touch mutation.separator — real sqlite3 keeps .separator
      // independent of .mode (csv/tabs hardcode their separators in the
      // formatter; list reads from options.separator). Mutating separator
      // here would clobber an explicit .separator that ran earlier.
      return { kind: "drop" };
    }
    case ".separator": {
      if (args.length === 0) {
        return {
          kind: "error",
          message: "Error: .separator requires an argument",
        };
      }
      mutation.separator = args[0];
      if (args.length > 1) mutation.newline = args[1];
      return { kind: "drop" };
    }
    case ".nullvalue": {
      mutation.nullValue = args[0] ?? "";
      return { kind: "drop" };
    }
    case ".tables": {
      const pat = args[0];
      const baseFilter =
        "type='table' AND name NOT LIKE 'sqlite~_%' ESCAPE '~'";
      const where = pat
        ? `${baseFilter} AND name LIKE ${sqlString(globToSqlLike(pat))}`
        : baseFilter;
      return {
        kind: "sql",
        sql: `SELECT name FROM sqlite_master WHERE ${where} ORDER BY name;`,
      };
    }
    case ".schema": {
      const pat = args[0];
      const baseFilter =
        "type IN ('table','index','view','trigger') AND sql IS NOT NULL";
      const where = pat
        ? `${baseFilter} AND name LIKE ${sqlString(globToSqlLike(pat))}`
        : baseFilter;
      // Append ';' so output mirrors real sqlite3 .schema (each CREATE ends with ;).
      return {
        kind: "sql",
        sql: `SELECT sql || ';' FROM sqlite_master WHERE ${where} ORDER BY name;`,
      };
    }
    case ".indexes":
    case ".indices": {
      const pat = args[0];
      const where = pat
        ? `type='index' AND tbl_name LIKE ${sqlString(globToSqlLike(pat))}`
        : "type='index'";
      return {
        kind: "sql",
        sql: `SELECT name FROM sqlite_master WHERE ${where} ORDER BY name;`,
      };
    }
    case ".databases":
      return { kind: "sql", sql: "PRAGMA database_list;" };
    case ".help":
      return { kind: "sql", sql: `SELECT ${sqlString(HELP_TEXT)} AS help;` };
    case ".quit":
    case ".exit":
      return { kind: "quit" };
    case ".read": {
      const file = args[0];
      if (!file) {
        return { kind: "error", message: "Error: usage: .read FILE" };
      }
      if (ctx.depth >= MAX_READ_DEPTH) {
        return { kind: "error", message: "Error: .read depth limit exceeded" };
      }
      let contents: string;
      try {
        const path = ctx.fs.resolvePath(ctx.cwd, file);
        contents = await ctx.fs.readFile(path);
      } catch (e) {
        return {
          kind: "error",
          message: `Error: cannot open "${file}": ${sanitizeErrorMessage((e as Error).message)}`,
        };
      }
      const sub = await preprocessDotCommandsInternal(contents, mutation, {
        fs: ctx.fs,
        cwd: ctx.cwd,
        depth: ctx.depth + 1,
      });
      if (sub.error) return { kind: "error", message: sub.error };
      return { kind: "sql", sql: sub.sql, quit: sub.quit };
    }
    case ".dump":
      return notImplementedSelect(
        cmd,
        "query sqlite_master for schema, then emit per-table SELECTs",
      );
    case ".save":
    case ".backup":
      return notImplementedSelect(
        cmd,
        "emit a SELECT and redirect with shell instead",
      );
    case ".import":
      return notImplementedSelect(
        cmd,
        "read the source file with cat and run INSERTs from a SQL script",
      );
    case ".restore":
    case ".open":
      return notImplementedSelect(
        cmd,
        "open the file directly: sqlite3 path.db",
      );
    case ".clone":
      return notImplementedSelect(
        cmd,
        "use .schema then INSERT INTO ... SELECT to copy",
      );
    case ".output":
      return notImplementedSelect(cmd, "redirect output with shell > or |");
    case ".shell":
    case ".system":
      return notImplementedSelect(cmd, "use bash for shell commands");
    case ".cd":
      return notImplementedSelect(
        cmd,
        "use bash 'cd' for working-directory changes",
      );
    case ".load":
      return notImplementedSelect(
        cmd,
        "extension loading is disabled in this sandbox",
      );
    case ".iotrace":
    case ".log":
    case ".excel":
      return notImplementedSelect(cmd, "not available in this sandbox");
    default:
      // Unknown dot-command — leave it in place so sql.js produces its
      // native "near \".\": syntax error".
      return { kind: "passthrough" };
  }
}

async function preprocessDotCommandsInternal(
  sql: string,
  mutation: FormatterMutation,
  ctx: PreprocessCtx,
): Promise<PreprocessResult> {
  // Fast path: no `.` at any potential boundary anywhere → nothing to do.
  if (!/(?:^|;|\n)\s*\./.test(sql)) {
    return { sql, formatterMutation: mutation };
  }

  let out = "";
  let i = 0;
  let atBoundary = true;
  let buffered = "";

  const len = sql.length;

  while (i < len) {
    const ch = sql[i];
    const next = sql[i + 1];

    // SQL string literal: track but do not translate inside.
    if (ch === "'" || ch === '"') {
      out += buffered;
      buffered = "";
      const quote = ch;
      out += ch;
      i++;
      while (i < len) {
        const c = sql[i];
        out += c;
        i++;
        if (c === quote) {
          if (sql[i] === quote) {
            // Doubled-quote escape — consume the second quote and keep going.
            out += sql[i];
            i++;
            continue;
          }
          break;
        }
      }
      atBoundary = false;
      continue;
    }

    // SQL line comment: `-- ...` to end of line. Don't consume the newline;
    // the main loop handles it as a boundary on the next iteration.
    if (ch === "-" && next === "-") {
      out += buffered;
      buffered = "";
      while (i < len && sql[i] !== "\n") {
        out += sql[i];
        i++;
      }
      continue;
    }

    // SQL block comment: `/* ... */`. Not nested in SQLite. A block
    // comment is content, so we leave boundary state — a dot-command
    // immediately after `*/` (with no intervening `\n`) is therefore
    // not recognized, matching real sqlite3's "dot-command must start
    // a line" rule.
    if (ch === "/" && next === "*") {
      out += buffered;
      buffered = "";
      out += "/*";
      i += 2;
      while (i < len) {
        if (sql[i] === "*" && sql[i + 1] === "/") {
          out += "*/";
          i += 2;
          break;
        }
        out += sql[i];
        i++;
      }
      atBoundary = false;
      continue;
    }

    // Statement boundary.
    if (ch === ";" || ch === "\n") {
      out += buffered;
      buffered = "";
      out += ch;
      atBoundary = true;
      i++;
      continue;
    }

    // Whitespace at boundary — buffer until we know whether this segment
    // is a dot-command (then drop the buffer) or SQL (then flush it through).
    if (ch === " " || ch === "\t" || ch === "\r") {
      buffered += ch;
      i++;
      continue;
    }

    // Possible dot-command at boundary. The `[a-zA-Z]` guard rejects SQL
    // numeric continuations like `.5` and other non-command dots.
    if (atBoundary && ch === "." && next && /[a-zA-Z]/.test(next)) {
      let j = i + 1;
      const cmdStart = j;
      while (j < len && /[a-zA-Z0-9_]/.test(sql[j] ?? "")) j++;
      const cmd = `.${sql.slice(cmdStart, j).toLowerCase()}`;
      const tail: string[] = [];
      while (j < len && sql[j] !== ";" && sql[j] !== "\n") {
        tail.push(sql[j]);
        j++;
      }
      const args = tokenizeArgs(tail.join(""));

      const result = await translateDotCommand(cmd, args, mutation, ctx);

      // Whether this dot-command leaves us at a fresh statement boundary
      // for the next iteration. Default: no — the dot-command itself was
      // mid-statement content as far as the surrounding scanner is
      // concerned. Override below for the drop+`;` case where consuming
      // the terminator means the next char IS at a boundary.
      let nextAtBoundary = false;
      if (result.kind === "drop") {
        // Discard the command and any whitespace that led up to it.
        // Also consume a trailing `;` so a single-line `.headers on; SQL`
        // doesn't leave an empty statement in the output. `\n` is left
        // alone so it can preserve line structure and re-trigger boundary
        // detection on the next iteration.
        buffered = "";
        if (j < len && sql[j] === ";") {
          j++;
          // We just consumed the statement terminator — the next iteration
          // starts at a real boundary, so a chained `.mode csv` on the same
          // line (e.g. `.headers on; .mode csv;`) gets recognized.
          nextAtBoundary = true;
        }
      } else if (result.kind === "passthrough") {
        // Leave the dot-command in place verbatim (sql.js will syntax-error).
        out += buffered;
        buffered = "";
        out += sql.slice(i, j);
      } else if (result.kind === "quit") {
        return { sql: out, formatterMutation: mutation, quit: true };
      } else if (result.kind === "error") {
        return {
          sql: out,
          formatterMutation: mutation,
          error: sanitizeErrorMessage(result.message),
        };
      } else {
        // kind === "sql"
        out += buffered;
        buffered = "";
        out += result.sql;
        if (result.quit) {
          return { sql: out, formatterMutation: mutation, quit: true };
        }
      }

      i = j;
      atBoundary = nextAtBoundary;
      continue;
    }

    // Regular character — flush buffer, emit, leave boundary.
    out += buffered;
    buffered = "";
    out += ch;
    atBoundary = false;
    i++;
  }

  out += buffered;
  return { sql: out, formatterMutation: mutation };
}

/**
 * Public entry point. Char-scans the SQL, replacing recognized dot-commands
 * with equivalent SQL (or applying formatter mutations / inlining .read'd
 * files / dropping silent no-ops), and returns the rewritten SQL plus the
 * accumulated formatter state.
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
