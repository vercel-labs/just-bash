/**
 * Worker thread for sqlite3 query execution.
 *
 * This isolates potentially long-running queries so they can be
 * terminated if they exceed the timeout.
 *
 * Uses sql.js (WASM-based SQLite) which is fully sandboxed and cannot
 * access the real filesystem.
 *
 * Security: Uses phased defense-in-depth:
 * 1. Init phase: sql.js WASM loads without restrictions
 * 2. Defense phase: Activate full blocking after sql.js init
 * 3. Execute phase: User SQL runs with all dangerous globals blocked
 */

import { parentPort, workerData } from "node:worker_threads";
import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";
import { sanitizeHostErrorMessage } from "../../fs/sanitize-error.js";
import {
  WorkerDefenseInDepth,
  type WorkerDefenseStats,
} from "../../security/index.js";
import {
  sanitizeUnknownError,
  wrapWasmCallback,
} from "../../security/wasm-callback.js";

// Cached SQL.js module (initialized once)
let cachedSQL: SqlJsStatic | null = null;

/**
 * Coerce a host-supplied dbBuffer into the form sql.js expects.
 *
 * Why: Bun's worker_threads structured-clone has regressed across versions
 * (notably the build shipped in Trigger.dev's container) and surfaces a
 * host-side `null` dbBuffer as a zero-length ArrayBuffer here. A truthy
 * empty ArrayBuffer would slip past `if (data.dbBuffer)` and reach
 * `new SQL.Database(arrayBuffer)`, which throws "Expected ArrayBuffer for
 * the first argument" (sql.js wants Uint8Array, not bare ArrayBuffer).
 * Treat empty/non-Uint8Array values as "no buffer" → fresh in-memory db,
 * matching the host's intent for :memory: databases.
 */
export function coerceDbBuffer(raw: unknown): Uint8Array | null {
  if (raw instanceof Uint8Array) {
    return raw;
  }
  if (
    raw &&
    typeof (raw as { byteLength?: unknown }).byteLength === "number" &&
    (raw as ArrayBuffer).byteLength > 0
  ) {
    return new Uint8Array(raw as ArrayBufferLike);
  }
  return null;
}

// Defense instance (activated after sql.js init)
let defense: WorkerDefenseInDepth | null = null;

function wrapWorkerMessage(
  protocolToken: string,
  message: unknown,
): Record<string, unknown> {
  const wrapped = Object.create(null) as Record<string, unknown>;

  if (!message || typeof message !== "object") {
    wrapped.success = false;
    wrapped.error = "Worker attempted to post non-object message";
    wrapped.protocolToken = protocolToken;
    return wrapped;
  }

  for (const [key, value] of Object.entries(message as Record<string, unknown>))
    wrapped[key] = value;

  // Set token AFTER copying message entries to prevent payload from overwriting it
  wrapped.protocolToken = protocolToken;
  return wrapped;
}

function postWorkerMessage(protocolToken: string, message: unknown): void {
  try {
    parentPort?.postMessage(wrapWorkerMessage(protocolToken, message));
  } catch (error) {
    // Best effort: avoid crashing worker when parent port is unavailable.
    console.debug(
      "[sqlite3-worker] failed to post worker message:",
      sanitizeUnknownError(error),
    );
  }
}

/**
 * Initialize sql.js and activate defense-in-depth.
 * Called once per worker lifetime.
 */
async function initializeWithDefense(
  protocolToken: string,
): Promise<SqlJsStatic> {
  if (cachedSQL) {
    return cachedSQL;
  }

  // Initialize sql.js WASM first (needs unrestricted JS features)
  cachedSQL = await initSqlJs();

  // Activate defense after sql.js is loaded (no exclusions needed)
  const onViolation = wrapWasmCallback(
    "sqlite3-worker",
    "onViolation",
    (v: unknown) => {
      postWorkerMessage(protocolToken, {
        type: "security-violation",
        violation: v,
      });
    },
  );

  defense = new WorkerDefenseInDepth({ onViolation });

  return cachedSQL;
}

export interface WorkerInput {
  protocolToken: string;
  dbBuffer: Uint8Array | null; // null for :memory:
  sql: string;
  options: {
    bail: boolean;
    echo: boolean;
  };
}

export interface WorkerSuccess {
  success: true;
  results: StatementResult[];
  hasModifications: boolean;
  dbBuffer: Uint8Array | null; // serialized db if modified
  /** Defense-in-depth stats if enabled */
  defenseStats?: WorkerDefenseStats;
}

export interface StatementResult {
  type: "data" | "error";
  columns?: string[];
  rows?: unknown[][];
  error?: string;
}

export interface WorkerError {
  success: false;
  error: string;
  /** Defense-in-depth stats if enabled */
  defenseStats?: WorkerDefenseStats;
}

export type WorkerOutput = WorkerSuccess | WorkerError;

/**
 * Strip leading SQL comments and whitespace so that classification is
 * not fooled by `-- comment\nINSERT ...` or `/* x *\/ UPDATE ...`.
 */
function stripLeadingNoise(sql: string): string {
  let s = sql;
  for (;;) {
    const before = s;
    s = s.replace(/^\s+/, "");
    if (s.startsWith("--")) {
      const nl = s.indexOf("\n");
      s = nl === -1 ? "" : s.slice(nl + 1);
    } else if (s.startsWith("/*")) {
      const end = s.indexOf("*/");
      s = end === -1 ? "" : s.slice(end + 2);
    }
    if (s === before) return s;
  }
}

/**
 * Conservative classifier: returns true ONLY if the statement is
 * provably read-only. Anything else — CTE-prefixed writes (`WITH ...
 * INSERT/UPDATE/DELETE`), mutating PRAGMAs (`PRAGMA user_version=N`),
 * comment-led writes — is treated as potentially mutating so the DB
 * is written back. Bias: false positives cost an extra writeback;
 * false negatives cause silent data loss (the original bug).
 */
function isReadOnlyStatement(sql: string): boolean {
  const s = stripLeadingNoise(sql).toUpperCase();
  if (s.startsWith("SELECT")) return true;
  if (s.startsWith("EXPLAIN")) return true;
  if (s.startsWith("VALUES")) return true;
  if (s.startsWith("PRAGMA")) {
    // `PRAGMA name` is a read; `PRAGMA name = value` and
    // `PRAGMA name(value)` mutate state.
    const rest = s.slice("PRAGMA".length);
    return !/[=(]/.test(rest);
  }
  return false;
}

function isWriteStatement(sql: string): boolean {
  const trimmed = stripLeadingNoise(sql).toUpperCase();
  return (
    trimmed.startsWith("INSERT") ||
    trimmed.startsWith("UPDATE") ||
    trimmed.startsWith("DELETE") ||
    trimmed.startsWith("CREATE") ||
    trimmed.startsWith("DROP") ||
    trimmed.startsWith("ALTER") ||
    trimmed.startsWith("REPLACE") ||
    trimmed.startsWith("VACUUM")
  );
}

function quoteSqlString(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

const DOT_SKIP = Symbol("dot-skip");

function preprocessDotCommands(sql: string): string {
  if (!/(^|;|\n)\s*\./.test(sql)) {
    return sql;
  }

  let out = "";
  let i = 0;
  let atBoundary = true;
  let buffered = "";

  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (ch === "'") {
      out += buffered;
      buffered = "";
      out += ch;
      i++;
      while (i < sql.length) {
        const c = sql[i];
        out += c;
        i++;
        if (c === "'") {
          if (sql[i] === "'") {
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

    if (ch === '"') {
      out += buffered;
      buffered = "";
      out += ch;
      i++;
      while (i < sql.length) {
        const c = sql[i];
        out += c;
        i++;
        if (c === '"') {
          if (sql[i] === '"') {
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

    if (ch === "-" && next === "-") {
      out += buffered;
      buffered = "";
      while (i < sql.length && sql[i] !== "\n") {
        out += sql[i];
        i++;
      }
      continue;
    }

    if (ch === "/" && next === "*") {
      out += buffered;
      buffered = "";
      out += "/*";
      i += 2;
      while (i < sql.length) {
        if (sql[i] === "*" && sql[i + 1] === "/") {
          out += "*/";
          i += 2;
          break;
        }
        out += sql[i];
        i++;
      }
      continue;
    }

    if (ch === ";" || ch === "\n") {
      out += buffered;
      buffered = "";
      out += ch;
      atBoundary = true;
      i++;
      continue;
    }

    if (ch === " " || ch === "\t" || ch === "\r") {
      buffered += ch;
      i++;
      continue;
    }

    if (atBoundary && ch === ".") {
      let j = i + 1;
      const cmdStart = j;
      while (j < sql.length && /[a-zA-Z_0-9]/.test(sql[j] ?? "")) j++;
      const cmd = sql.slice(cmdStart, j).toLowerCase();
      const argsStart = j;
      while (j < sql.length && sql[j] !== ";" && sql[j] !== "\n") j++;
      const args = sql.slice(argsStart, j).trim();

      const translated = translateDotCommand(cmd, args);
      if (translated === DOT_SKIP) {
        buffered = "";
      } else if (translated === null) {
        out += buffered;
        out += sql.slice(i, j);
        buffered = "";
      } else {
        out += buffered;
        out += translated;
        buffered = "";
      }
      i = j;
      atBoundary = false;
      continue;
    }

    out += buffered;
    buffered = "";
    out += ch;
    atBoundary = false;
    i++;
  }

  out += buffered;
  return out;
}

function translateDotCommand(
  cmd: string,
  args: string,
): string | null | typeof DOT_SKIP {
  switch (cmd) {
    case "tables": {
      const where = args
        ? `AND name LIKE ${quoteSqlString(args.replace(/\*/g, "%"))}`
        : "";
      return `SELECT name FROM sqlite_master WHERE type IN ('table','view') ${where} ORDER BY name;`;
    }
    case "schema": {
      const where = args ? `AND name = ${quoteSqlString(args)}` : "";
      return `SELECT sql FROM sqlite_master WHERE type IN ('table','view','index','trigger') ${where} AND sql IS NOT NULL ORDER BY name;`;
    }
    case "indexes":
    case "indices": {
      const where = args ? `AND tbl_name = ${quoteSqlString(args)}` : "";
      return `SELECT name FROM sqlite_master WHERE type='index' ${where} ORDER BY name;`;
    }
    case "databases":
      return "PRAGMA database_list;";

    case "headers":
    case "mode":
    case "separator":
    case "nullvalue":
    case "echo":
    case "timer":
    case "changes":
    case "bail":
    case "show":
    case "width":
      return DOT_SKIP;

    case "quit":
    case "exit":
      return null;

    case "read":
      return `SELECT ${quoteSqlString(`sqlite3: .read is not supported in this sandbox - use: cat ${args || "FILE"} | sqlite3 DB`)} AS error;`;
    case "save":
    case "backup":
      return `SELECT ${quoteSqlString(`sqlite3: .${cmd} is not supported in this sandbox - emit a SELECT and redirect with shell instead`)} AS error;`;
    case "dump":
      return `SELECT ${quoteSqlString("sqlite3: .dump is not supported in this sandbox - query sqlite_master for schema, then emit per-table SELECTs")} AS error;`;
    case "import":
      return `SELECT ${quoteSqlString("sqlite3: .import is not supported in this sandbox - read the source file with cat and run INSERTs from a SQL script")} AS error;`;
    case "load":
    case "restore":
    case "open":
    case "output":
    case "log":
    case "shell":
    case "system":
    case "cd":
      return `SELECT ${quoteSqlString(`sqlite3: .${cmd} is not supported in this sandbox`)} AS error;`;

    case "help":
      return `SELECT ${quoteSqlString("Supported dot commands: .tables [pattern], .schema [name], .indexes [table], .databases. Use SQL for everything else; .read/.save/.dump/.import are not available in this sandbox.")} AS help;`;

    default:
      return null;
  }
}

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

async function executeQuery(data: WorkerInput): Promise<WorkerOutput> {
  let db: Database;

  try {
    const SQL = await initializeWithDefense(data.protocolToken);

    const buf = coerceDbBuffer(data.dbBuffer);
    db = buf ? new SQL.Database(buf) : new SQL.Database();
  } catch (e) {
    const message = sanitizeHostErrorMessage((e as Error).message);
    return {
      success: false,
      error: message,
      defenseStats: defense?.getStats(),
    };
  }

  const results: StatementResult[] = [];
  let hasModifications = false;

  try {
    const processedSql = preprocessDotCommands(data.sql);
    const statements = splitStatements(processedSql);

    for (const stmt of statements) {
      try {
        if (isWriteStatement(stmt)) {
          db.run(stmt);
          hasModifications = true;
          results.push({ type: "data", columns: [], rows: [] });
        } else {
          // Use prepared statement to get column names even for empty result sets
          const prepared = db.prepare(stmt);
          const columns = prepared.getColumnNames();
          const rows: unknown[][] = [];

          while (prepared.step()) {
            rows.push(prepared.get());
          }

          prepared.free();
          results.push({ type: "data", columns, rows });

          // Anything that is not provably read-only must trigger writeback.
          // Catches CTE-prefixed writes (WITH ... INSERT), mutating PRAGMAs
          // (PRAGMA user_version=N), and comment-led writes that the
          // startsWith allowlist in isWriteStatement misses.
          if (!isReadOnlyStatement(stmt)) {
            hasModifications = true;
          }
        }
      } catch (e) {
        const error = (e as Error).message;
        results.push({ type: "error", error });
        if (data.options.bail) {
          break;
        }
      }
    }

    let resultBuffer: Uint8Array | null = null;
    if (hasModifications) {
      resultBuffer = db.export();
    }

    db.close();
    return {
      success: true,
      results,
      hasModifications,
      dbBuffer: resultBuffer,
      defenseStats: defense?.getStats(),
    };
  } catch (e) {
    db.close();
    const message = sanitizeHostErrorMessage((e as Error).message);
    return {
      success: false,
      error: message,
      defenseStats: defense?.getStats(),
    };
  }
}

// Execute when run as worker
if (parentPort && workerData) {
  const input = workerData as WorkerInput;
  executeQuery(input)
    .then((result) => {
      postWorkerMessage(input.protocolToken, result);
    })
    .catch((error) => {
      postWorkerMessage(input.protocolToken, {
        success: false,
        error: sanitizeUnknownError(error),
        defenseStats: defense?.getStats(),
      });
    });
}
