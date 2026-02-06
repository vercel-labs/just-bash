/**
 * sqlite3 - SQLite database CLI
 *
 * Wraps sql.js (WASM) to provide SQLite database access through the virtual filesystem.
 * Databases are loaded from buffers and written back after modifications.
 *
 * Queries run in a worker thread with a timeout to prevent runaway queries
 * (e.g., infinite recursive CTEs) from blocking execution.
 *
 * Security: sql.js is fully sandboxed - it cannot access the real filesystem,
 * making ATTACH DATABASE and VACUUM INTO safe (they only operate on virtual buffers).
 */

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import initSqlJs from "sql.js";
import type { Command, CommandContext, ExecResult } from "../../types.js";
import { hasHelpFlag, showHelp } from "../help.js";
import {
  type FormatOptions,
  formatOutput,
  type OutputMode,
} from "./formatters.js";
import type { WorkerInput, WorkerOutput } from "./worker.js";

/** Default query timeout in milliseconds (5 seconds) */
const DEFAULT_QUERY_TIMEOUT_MS = 5000;

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

// Get SQLite version from sql.js
async function getSqliteVersion(): Promise<string> {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  try {
    const result = db.exec("SELECT sqlite_version()");
    if (result.length > 0 && result[0].values.length > 0) {
      return String(result[0].values[0][0]);
    }
    return "unknown";
  } finally {
    db.close();
  }
}

/**
 * Find the sqlite3 worker.js file path.
 * Checks multiple locations for different environments:
 * - dist/commands/sqlite3/worker.js (production, bundled)
 * - ./worker.js (development from dist/)
 * - ../../../dist/commands/sqlite3/worker.js (tests from src/)
 */
function findWorkerPath(): string {
  const currentDir = dirname(fileURLToPath(import.meta.url));

  // For bundled builds, go up to find dist/commands/sqlite3/worker.js
  // This handles both dist/bin/chunks/ and dist/bundle/chunks/ cases
  const bundledPath = join(currentDir, "../../commands/sqlite3/worker.js");
  if (existsSync(bundledPath)) {
    return bundledPath;
  }

  // For non-bundled dist (e.g., dist/commands/sqlite3/sqlite3.js)
  const distPath = join(currentDir, "worker.js");
  if (existsSync(distPath)) {
    return distPath;
  }

  // For tests running from TypeScript source
  const srcToDistPath = join(
    currentDir,
    "../../../dist/commands/sqlite3/worker.js",
  );
  if (existsSync(srcToDistPath)) {
    return srcToDistPath;
  }

  throw new Error(
    "sqlite3 worker not found. Run 'pnpm build' to compile the worker.",
  );
}

async function executeInWorker(
  input: WorkerInput,
  timeoutMs: number,
): Promise<WorkerOutput> {
  // Try to use worker thread for timeout protection
  try {
    const workerPath = findWorkerPath();

    return await new Promise((resolve, reject) => {
      const worker = new Worker(workerPath, {
        workerData: input,
      });

      const timeout = setTimeout(() => {
        worker.terminate();
        resolve({
          success: false,
          error: `Query timeout: execution exceeded ${timeoutMs}ms limit`,
        });
      }, timeoutMs);

      worker.on("message", (result: WorkerOutput) => {
        clearTimeout(timeout);
        resolve(result);
      });

      worker.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      worker.on("exit", (code) => {
        clearTimeout(timeout);
        if (code !== 0) {
          resolve({
            success: false,
            error: `Worker exited with code ${code}`,
          });
        }
      });
    });
  } catch (e) {
    // Worker failed to load - do not fall back to direct execution
    // as it has no timeout protection (DoS risk)
    throw new Error(`sqlite3 worker failed to load: ${(e as Error).message}`);
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
      const version = await getSqliteVersion();
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

    // Load database buffer
    const isMemory = database === ":memory:";
    let dbPath = "";
    let dbBuffer: Uint8Array | null = null;

    try {
      if (!isMemory) {
        dbPath = ctx.fs.resolvePath(ctx.cwd, database);
        if (await ctx.fs.exists(dbPath)) {
          dbBuffer = await ctx.fs.readFileBuffer(dbPath);
        }
      }
    } catch (e) {
      return {
        stdout: "",
        stderr: `sqlite3: unable to open database "${database}": ${(e as Error).message}\n`,
        exitCode: 1,
      };
    }

    // Get timeout from execution limits or use default
    const timeoutMs =
      ctx.limits?.maxSqliteTimeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS;

    // Execute in worker with timeout
    const workerInput: WorkerInput = {
      dbBuffer,
      sql,
      options: {
        bail: options.bail,
        echo: options.echo,
      },
    };

    let result: WorkerOutput;
    try {
      result = await executeInWorker(workerInput, timeoutMs);
    } catch (e) {
      return {
        stdout: "",
        stderr: `sqlite3: worker error: ${(e as Error).message}\n`,
        exitCode: 1,
      };
    }

    if (!result.success) {
      return {
        stdout: "",
        stderr: `sqlite3: ${result.error}\n`,
        exitCode: 1,
      };
    }

    // Format output
    const formatOptions: FormatOptions = {
      mode: options.mode,
      header: options.header,
      separator: options.separator,
      newline: options.newline,
      nullValue: options.nullValue,
    };

    let stdout = "";

    // Echo SQL if requested
    if (options.echo) {
      stdout += `${sql}\n`;
    }

    // Process results
    let hadError = false;
    for (const stmtResult of result.results) {
      if (stmtResult.type === "error") {
        if (options.bail) {
          return {
            stdout,
            stderr: `Error: ${stmtResult.error}\n`,
            exitCode: 1,
          };
        }
        stdout += `Error: ${stmtResult.error}\n`;
        hadError = true;
      } else if (stmtResult.columns && stmtResult.rows) {
        if (stmtResult.rows.length > 0 || options.header) {
          stdout += formatOutput(
            stmtResult.columns,
            stmtResult.rows,
            formatOptions,
          );
        }
      }
    }

    // Write back modifications if needed
    if (
      result.hasModifications &&
      !options.readonly &&
      !isMemory &&
      dbPath &&
      result.dbBuffer
    ) {
      try {
        await ctx.fs.writeFile(dbPath, result.dbBuffer);
      } catch (e) {
        return {
          stdout,
          stderr: `sqlite3: failed to write database: ${(e as Error).message}\n`,
          exitCode: 1,
        };
      }
    }

    return { stdout, stderr: "", exitCode: hadError && options.bail ? 1 : 0 };
  },
};

import type { CommandFuzzInfo } from "../fuzz-flags-types.js";

export const flagsForFuzzing: CommandFuzzInfo = {
  name: "sqlite3",
  flags: [],
  needsArgs: true,
};
