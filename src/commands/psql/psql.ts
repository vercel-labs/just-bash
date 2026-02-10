/**
 * psql - PostgreSQL interactive terminal
 *
 * Implements a subset of psql functionality for executing SQL queries
 * against PostgreSQL databases with Deno Sandbox-style secrets management.
 *
 * Security:
 * - Requires explicit network configuration with allowedPostgresHosts
 * - Supports transparent credential injection (user code never sees production passwords)
 * - Query timeout protection to prevent runaway queries
 * - Single connection per command to prevent resource exhaustion
 */

import type { Command, CommandContext, ExecResult } from "../../types.js";
import { hasHelpFlag, showHelp } from "../help.js";
import { buildConnectionOptions, getSqlToExecute } from "./connection.js";
import { formatResults } from "./formatters.js";
import { parseArgs } from "./parser.js";

const DEFAULT_QUERY_TIMEOUT_MS = 5000;

const psqlHelp = {
  name: "psql",
  summary: "PostgreSQL interactive terminal",
  usage: "psql [OPTIONS] [DBNAME]",
  options: [
    "-h, --host HOST        database server host",
    "-p, --port PORT        database server port (default: 5432)",
    "-U, --username USER    database user name",
    "-d, --dbname DBNAME    database name to connect to",
    "-c, --command COMMAND  run single command (SQL) and exit",
    "-f, --file FILE        execute commands from file",
    "-t, --tuples-only      print rows only (no header)",
    "-A, --no-align         unaligned table output mode",
    "-F SEP                 field separator (default: |)",
    "-R SEP                 record separator (default: \\n)",
    "--csv                  CSV output mode",
    "--json                 JSON output mode",
    "-H, --html             HTML table output mode",
    "-q, --quiet            suppress notices and row count",
    "-1, --single-transaction  execute as single transaction",
    "-o, --output FILE      send output to file",
    "--set=VAR=VALUE        set psql variable VAR to VALUE",
    "--help                 show this help",
  ],
  examples: [
    'psql -h localhost -U myuser -d mydb -c "SELECT version()"',
    'psql -h localhost -d mydb --json -c "SELECT * FROM users"',
    'echo "SELECT 1+1" | psql -h localhost -d mydb',
    'psql -h localhost -d mydb --csv -t -c "SELECT id, name FROM products"',
  ],
};

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
        // Check for escaped quote
        if (sql[i + 1] === stringChar) {
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

/**
 * Execute SQL with timeout protection
 */
async function executeWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(
        new Error(
          `Query timeout: execution exceeded ${timeoutMs}ms limit. Increase ctx.limits.maxPostgresTimeoutMs if needed.`,
        ),
      );
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export const psqlCommand: Command = {
  name: "psql",

  async execute(args: string[], ctx: CommandContext): Promise<ExecResult> {
    if (hasHelpFlag(args)) {
      return showHelp(psqlHelp);
    }

    // Check if PostgreSQL access is configured
    if (!ctx.connectPostgres) {
      return {
        stdout: "",
        stderr:
          "psql: PostgreSQL access not configured. Configure 'allowedPostgresHosts' in network options.\n",
        exitCode: 1,
      };
    }

    // Parse options
    const parsed = parseArgs(args);
    if ("exitCode" in parsed) return parsed;

    const options = parsed;

    // Build connection options
    const connOptions = buildConnectionOptions(options);
    if (!connOptions) {
      return {
        stdout: "",
        stderr: "psql: no host specified (-h/--host required)\n",
        exitCode: 1,
      };
    }

    // Get SQL to execute
    const sql = getSqlToExecute(options, ctx.stdin);
    if (!sql) {
      return {
        stdout: "",
        stderr: "psql: no SQL provided (use -c, -f, or stdin)\n",
        exitCode: 1,
      };
    }

    // Read SQL from file if specified
    let sqlToExecute: string;
    if (options.file) {
      try {
        const filePath = ctx.fs.resolvePath(ctx.cwd, options.file);
        sqlToExecute = await ctx.fs.readFile(filePath);
      } catch (e) {
        return {
          stdout: "",
          stderr: `psql: ${options.file}: ${(e as Error).message}\n`,
          exitCode: 1,
        };
      }
    } else {
      // Use SQL from -c or stdin
      sqlToExecute = sql;
    }

    // Connect to PostgreSQL
    let sql_connection: Awaited<ReturnType<typeof ctx.connectPostgres>>;
    try {
      sql_connection = await ctx.connectPostgres(connOptions);
    } catch (e) {
      return {
        stdout: "",
        stderr: `psql: ${(e as Error).message}\n`,
        exitCode: 1,
      };
    }

    try {
      // Get timeout from execution limits or use default
      const timeoutMs =
        ctx.limits?.maxPostgresTimeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS;

      // Split into statements
      const statements = splitStatements(sqlToExecute);
      let output = "";

      // Execute statements
      for (const stmt of statements) {
        try {
          const result = await executeWithTimeout(
            sql_connection.unsafe(stmt),
            timeoutMs,
          );

          // Format results
          if (Array.isArray(result) && result.length > 0) {
            const columns = Object.keys(result[0] as object);
            const rows = result.map((row) =>
              columns.map((col) => (row as Record<string, unknown>)[col]),
            );

            output += formatResults(columns, rows, options);
          } else {
            // No results (e.g., INSERT, UPDATE, DELETE without RETURNING)
            if (!options.quiet) {
              // Try to show affected rows if available
              output += `Command completed successfully${options.recordSeparator}`;
            }
          }
        } catch (e) {
          const error = (e as Error).message;
          return {
            stdout: output,
            stderr: `psql: ERROR: ${error}\n`,
            exitCode: 1,
          };
        }
      }

      // Write output to file if requested
      if (options.outputFile) {
        try {
          const filePath = ctx.fs.resolvePath(ctx.cwd, options.outputFile);
          await ctx.fs.writeFile(filePath, output);
          return { stdout: "", stderr: "", exitCode: 0 };
        } catch (e) {
          return {
            stdout: output,
            stderr: `psql: ${options.outputFile}: ${(e as Error).message}\n`,
            exitCode: 1,
          };
        }
      }

      return { stdout: output, stderr: "", exitCode: 0 };
    } finally {
      // Always close connection
      await sql_connection.end();
    }
  },
};
