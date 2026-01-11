/**
 * sqlite3 - SQLite database CLI
 *
 * Wraps better-sqlite3 to provide SQLite database access through the virtual filesystem.
 * Databases are loaded from buffers and written back after modifications.
 */

import Database from "better-sqlite3";
import type { Command, CommandContext, ExecResult } from "../../types.js";
import { hasHelpFlag, showHelp } from "../help.js";
import {
  type FormatOptions,
  formatOutput,
  type OutputMode,
} from "./formatters.js";

const sqlite3Help = {
  name: "sqlite3",
  summary: "SQLite database CLI",
  usage: "sqlite3 [OPTIONS] DATABASE [SQL]",
  options: [
    "-list           output in list mode (default)",
    "-csv            output in CSV mode",
    "-json           output in JSON mode",
    "-line           output in line mode",
    "-column         output in column mode",
    "-table          output as ASCII table",
    "-markdown       output as markdown table",
    "-tabs           output in tab-separated mode",
    "-box            output in Unicode box mode",
    "-quote          output in SQL quote mode",
    "-html           output as HTML table",
    "-ascii          output in ASCII mode (control chars)",
    "-header         show column headers",
    "-noheader       hide column headers",
    "-separator SEP  field separator for list mode (default: |)",
    "-newline SEP    row separator (default: \\n)",
    "-nullvalue TEXT text for NULL values (default: empty)",
    "-readonly       open database read-only (no writeback)",
    "-bail           stop on first error",
    "-echo           print SQL before execution",
    "-cmd COMMAND    run SQL command before main SQL",
    "-version        show SQLite version",
    "--              end of options",
    "--help          show this help",
  ],
  examples: [
    'sqlite3 :memory: "CREATE TABLE t(x); INSERT INTO t VALUES(1); SELECT * FROM t"',
    'sqlite3 -json data.db "SELECT * FROM users"',
    'sqlite3 -csv -header data.db "SELECT id, name FROM products"',
    'sqlite3 -box data.db "SELECT * FROM users"',
  ],
};

interface SqliteOptions {
  mode: OutputMode;
  header: boolean;
  separator: string;
  newline: string;
  nullValue: string;
  readonly: boolean;
  bail: boolean;
  echo: boolean;
  cmd: string | null;
}

function parseArgs(args: string[]):
  | {
      options: SqliteOptions;
      database: string | null;
      sql: string | null;
      showVersion: boolean;
    }
  | ExecResult {
  const options: SqliteOptions = {
    mode: "list",
    header: false,
    separator: "|",
    newline: "\n",
    nullValue: "",
    readonly: false,
    bail: false,
    echo: false,
    cmd: null,
  };

  let database: string | null = null;
  let sql: string | null = null;
  let showVersion = false;
  let endOfOptions = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    // After --, treat everything as positional arguments
    if (endOfOptions) {
      if (database === null) {
        database = arg;
      } else if (sql === null) {
        sql = arg;
      }
      continue;
    }

    if (arg === "--") {
      endOfOptions = true;
    } else if (arg === "-version") {
      showVersion = true;
    } else if (arg === "-list") options.mode = "list";
    else if (arg === "-csv") options.mode = "csv";
    else if (arg === "-json") options.mode = "json";
    else if (arg === "-line") options.mode = "line";
    else if (arg === "-column") options.mode = "column";
    else if (arg === "-table") options.mode = "table";
    else if (arg === "-markdown") options.mode = "markdown";
    else if (arg === "-tabs") options.mode = "tabs";
    else if (arg === "-box") options.mode = "box";
    else if (arg === "-quote") options.mode = "quote";
    else if (arg === "-html") options.mode = "html";
    else if (arg === "-ascii") options.mode = "ascii";
    else if (arg === "-header") options.header = true;
    else if (arg === "-noheader") options.header = false;
    else if (arg === "-readonly") options.readonly = true;
    else if (arg === "-bail") options.bail = true;
    else if (arg === "-echo") options.echo = true;
    else if (arg === "-separator") {
      if (i + 1 >= args.length) {
        return {
          stdout: "",
          stderr: "sqlite3: Error: missing argument to -separator\n",
          exitCode: 1,
        };
      }
      options.separator = args[++i];
    } else if (arg === "-newline") {
      if (i + 1 >= args.length) {
        return {
          stdout: "",
          stderr: "sqlite3: Error: missing argument to -newline\n",
          exitCode: 1,
        };
      }
      options.newline = args[++i];
    } else if (arg === "-nullvalue") {
      if (i + 1 >= args.length) {
        return {
          stdout: "",
          stderr: "sqlite3: Error: missing argument to -nullvalue\n",
          exitCode: 1,
        };
      }
      options.nullValue = args[++i];
    } else if (arg === "-cmd") {
      if (i + 1 >= args.length) {
        return {
          stdout: "",
          stderr: "sqlite3: Error: missing argument to -cmd\n",
          exitCode: 1,
        };
      }
      options.cmd = args[++i];
    } else if (arg.startsWith("-")) {
      // Real sqlite3 treats --xyz as -xyz and says "unknown option: -xyz"
      const optName = arg.startsWith("--") ? arg.slice(1) : arg;
      return {
        stdout: "",
        stderr: `sqlite3: Error: unknown option: ${optName}\nUse -help for a list of options.\n`,
        exitCode: 1,
      };
    } else if (database === null) {
      database = arg;
    } else if (sql === null) {
      sql = arg;
    }
  }

  return { options, database, sql, showVersion };
}

/**
 * Check if a SQL statement is a write operation
 */
function isWriteStatement(sql: string): boolean {
  const trimmed = sql.trim().toUpperCase();
  return (
    trimmed.startsWith("INSERT") ||
    trimmed.startsWith("UPDATE") ||
    trimmed.startsWith("DELETE") ||
    trimmed.startsWith("CREATE") ||
    trimmed.startsWith("DROP") ||
    trimmed.startsWith("ALTER") ||
    trimmed.startsWith("REPLACE")
  );
}

/**
 * Split SQL into individual statements
 */
function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let inString = false;
  let stringChar = "";

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];

    if (inString) {
      current += char;
      if (char === stringChar) {
        // SQL uses doubled quotes for escaping (e.g., 'it''s' or "he said ""hi""")
        if (sql[i + 1] === stringChar) {
          // Include the escaped quote and skip past it
          current += sql[++i];
        } else {
          inString = false;
        }
      }
    } else if (char === "'" || char === '"') {
      current += char;
      inString = true;
      stringChar = char;
    } else if (char === ";") {
      const stmt = current.trim();
      if (stmt) statements.push(stmt);
      current = "";
    } else {
      current += char;
    }
  }

  const stmt = current.trim();
  if (stmt) statements.push(stmt);

  return statements;
}

// Get SQLite version from better-sqlite3
function getSqliteVersion(): string {
  const db = new Database(":memory:");
  try {
    const result = db.prepare("SELECT sqlite_version()").get() as {
      "sqlite_version()": string;
    };
    return result["sqlite_version()"];
  } finally {
    db.close();
  }
}

export const sqlite3Command: Command = {
  name: "sqlite3",

  async execute(args: string[], ctx: CommandContext): Promise<ExecResult> {
    // Real sqlite3 accepts both -help and --help
    if (hasHelpFlag(args) || args.includes("-help"))
      return showHelp(sqlite3Help);

    const parsed = parseArgs(args);
    if ("exitCode" in parsed) return parsed;

    const { options, database, sql: sqlArg, showVersion } = parsed;

    // Handle -version
    if (showVersion) {
      const version = getSqliteVersion();
      return {
        stdout: `${version}\n`,
        stderr: "",
        exitCode: 0,
      };
    }

    if (!database) {
      return {
        stdout: "",
        stderr: "sqlite3: missing database argument\n",
        exitCode: 1,
      };
    }

    // Get SQL from argument or stdin, prepend -cmd if provided
    let sql = sqlArg || ctx.stdin.trim();
    if (options.cmd) {
      sql = options.cmd + (sql ? `; ${sql}` : "");
    }
    if (!sql) {
      return {
        stdout: "",
        stderr: "sqlite3: no SQL provided\n",
        exitCode: 1,
      };
    }

    // Open database
    let db: Database.Database;
    const isMemory = database === ":memory:";
    let dbPath = "";

    try {
      if (isMemory) {
        db = new Database(":memory:");
      } else {
        dbPath = ctx.fs.resolvePath(ctx.cwd, database);
        if (await ctx.fs.exists(dbPath)) {
          const buffer = await ctx.fs.readFileBuffer(dbPath);
          db = new Database(Buffer.from(buffer));
        } else {
          // Create new database in memory (will be written on first modification)
          db = new Database(":memory:");
        }
      }
    } catch (e) {
      return {
        stdout: "",
        stderr: `sqlite3: unable to open database "${database}": ${(e as Error).message}\n`,
        exitCode: 1,
      };
    }

    const formatOptions: FormatOptions = {
      mode: options.mode,
      header: options.header,
      separator: options.separator,
      newline: options.newline,
      nullValue: options.nullValue,
    };

    let stdout = "";
    let hasModifications = false;

    // Echo SQL if requested
    if (options.echo) {
      stdout += `${sql}\n`;
    }

    try {
      const statements = splitStatements(sql);

      for (const stmt of statements) {
        try {
          if (isWriteStatement(stmt)) {
            db.exec(stmt);
            hasModifications = true;
          } else {
            // SELECT or other read statements
            const prepared = db.prepare(stmt);
            const columnInfo = prepared.columns();
            const columns = columnInfo.map((c) => c.name);

            // Use raw mode to get arrays instead of objects
            const rows = prepared.raw(true).all() as unknown[][];

            if (rows.length > 0 || options.header) {
              stdout += formatOutput(columns, rows, formatOptions);
            }
          }
        } catch (e) {
          const msg = (e as Error).message;
          if (options.bail) {
            return {
              stdout,
              stderr: `Error: ${msg}\n`,
              exitCode: 1,
            };
          }
          // For non-bail mode, continue with next statement
          stdout += `Error: ${msg}\n`;
        }
      }

      // Write back modifications if needed
      if (hasModifications && !options.readonly && !isMemory && dbPath) {
        try {
          const buffer = db.serialize();
          await ctx.fs.writeFile(dbPath, buffer);
        } catch (e) {
          return {
            stdout,
            stderr: `sqlite3: failed to write database: ${(e as Error).message}\n`,
            exitCode: 1,
          };
        }
      }

      return { stdout, stderr: "", exitCode: 0 };
    } finally {
      db.close();
    }
  },
};
