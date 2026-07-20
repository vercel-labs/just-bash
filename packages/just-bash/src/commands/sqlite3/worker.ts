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
import initSqlJs, {
  type Database,
  type SqlJsStatic,
  type Statement,
} from "sql.js";
import { sanitizeHostErrorMessage } from "../../fs/sanitize-error.js";
import {
  WorkerDefenseInDepth,
  type WorkerDefenseStats,
} from "../../security/index.js";
import { sanitizeUnknownError } from "../../security/wasm-callback.js";

const MIN_SQLITE_HEAP_LIMIT = 32 * 1024 * 1024;
const MAX_SQLITE_HEAP_LIMIT = 128 * 1024 * 1024;

// Cached SQL.js module (initialized once)
let cachedSQL: SqlJsStatic | null = null;

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
async function initializeSqlJs(): Promise<SqlJsStatic> {
  if (cachedSQL) {
    return cachedSQL;
  }

  // Initialize sql.js WASM first (needs unrestricted JS features). Database
  // construction is also prewarmed before defense activation below because
  // sql.js performs some Node module loading lazily on first use.
  cachedSQL = await initSqlJs();

  return cachedSQL;
}

function activateDefense(): void {
  if (defense) return;
  // Violations throw synchronously and are returned through the authenticated
  // final response. Calling parentPort.postMessage from inside the loader trap
  // can itself lazily load Node internals and recursively trigger the trap.
  // @banned-pattern-ignore: constructor receives a static options bag, never dynamic keys
  defense = new WorkerDefenseInDepth({});
}

export interface WorkerInput {
  protocolToken: string;
  dbBuffer: Uint8Array | null; // null for :memory:
  sql: string;
  options: {
    bail: boolean;
    echo: boolean;
  };
  limits: {
    maxResultRows: number;
    maxResultBytes: number;
    maxDatabaseBytes: number;
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
  // PRAGMAs are intentionally never allowlisted here. Several argumentless
  // forms mutate persistent state (for example incremental_vacuum), and an
  // extra writeback is safer than silently discarding a mutation.
  return false;
}

/**
 * Recover SQLite's remaining tail after prepare() fails. sql.js does not
 * expose sqlite3_prepare_v2's tail pointer on an error, so enumerate only
 * lexically possible top-level terminators and ask SQLite whether each
 * prefix is complete. The scanner never declares a boundary by itself.
 */
function tailAfterFailedPrepare(db: Database, sql: string): string | null {
  let quote: "'" | '"' | "`" | "]" | null = null;
  let lineComment = false;
  let blockComment = false;
  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    const next = sql[i + 1];
    if (lineComment) {
      if (char === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        i++;
      }
      continue;
    }
    if (quote !== null) {
      const closes = quote === "]" ? char === "]" : char === quote;
      if (closes) {
        if (quote !== "]" && next === quote) i++;
        else quote = null;
      }
      continue;
    }
    if (char === "-" && next === "-") {
      lineComment = true;
      i++;
      continue;
    }
    if (char === "/" && next === "*") {
      blockComment = true;
      i++;
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      continue;
    }
    if (char === "[") {
      quote = "]";
      continue;
    }
    if (char !== ";") continue;

    const prefix = sql.slice(0, i + 1);
    try {
      const statement = db.prepare(prefix);
      statement.free();
      return sql.slice(i + 1);
    } catch (error) {
      if (!/incomplete input/i.test((error as Error).message))
        return sql.slice(i + 1);
    }
  }
  return null;
}

function valueByteLength(value: unknown): number {
  if (value === null || value === undefined) return 4;
  if (value instanceof Uint8Array) return value.byteLength;
  if (typeof value === "string") return Buffer.byteLength(value, "utf8");
  return Buffer.byteLength(String(value), "utf8");
}

function databaseByteLength(db: Database): number {
  const pageCount = db.exec("PRAGMA page_count")[0]?.values[0]?.[0];
  const pageSize = db.exec("PRAGMA page_size")[0]?.values[0]?.[0];
  if (typeof pageCount !== "number" || typeof pageSize !== "number") return 0;
  return pageCount * pageSize;
}

async function executeQuery(data: WorkerInput): Promise<WorkerOutput> {
  let db: Database;

  try {
    if (
      data.dbBuffer &&
      data.dbBuffer.byteLength > data.limits.maxDatabaseBytes
    ) {
      throw new Error(
        `database exceeds ${data.limits.maxDatabaseBytes} byte limit`,
      );
    }
    const SQL = await initializeSqlJs();

    if (data.dbBuffer) {
      db = new SQL.Database(data.dbBuffer);
    } else {
      db = new SQL.Database();
    }
    // V8 worker resourceLimits do not cover WebAssembly linear memory. SQLite's
    // own hard heap limit stops randomblob/zeroblob and query intermediates
    // before they can grow the WASM allocator without bound. SQLite only lets
    // later PRAGMAs lower (not raise) an established hard limit.
    const sqliteHeapLimit = Math.min(
      MAX_SQLITE_HEAP_LIMIT,
      Math.max(
        MIN_SQLITE_HEAP_LIMIT,
        (data.dbBuffer?.byteLength ?? 0) + data.limits.maxResultBytes * 2,
      ),
    );
    db.run(`PRAGMA hard_heap_limit = ${sqliteHeapLimit}`);
    // Exercise the exact prepare/step/iterator paths used below while no guest
    // SQL is present. sql.js lazily resolves a small amount of Node glue on
    // first use even after initSqlJs() and Database construction complete.
    const bootstrapIterator = db.iterateStatements("SELECT 1");
    const bootstrapStatement = bootstrapIterator.next();
    if (!bootstrapStatement.done) {
      bootstrapStatement.value.step();
      bootstrapStatement.value.free();
    }
    // All sql.js/Database bootstrap operations are complete. No guest SQL has
    // run yet, so loader denial can now be activated without a guest callback
    // ever executing inside a trusted bootstrap window.
    activateDefense();
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
  let resultRows = 0;
  let resultBytes = 0;

  try {
    // Delegate statement boundary detection to SQLite itself. This correctly
    // preserves trigger bodies, comments, quoted identifiers, and every other
    // grammar construct in which a semicolon is not a statement terminator.
    let remainingSql = data.sql;
    while (remainingSql.trim().length > 0) {
      let prepared: Statement;
      const iterator = db.iterateStatements(remainingSql);
      try {
        const next = iterator.next();
        if (next.done) break;
        prepared = next.value;
        // Capture SQLite's exact unprepared tail before stepping. A runtime
        // error invalidates sql.js's iterator, but this tail remains safe to
        // prepare independently when non-bail mode continues.
        remainingSql = iterator.getRemainingSQL();
      } catch (e) {
        // SQLite could not prepare the next statement. In non-bail mode the
        // recovery helper asks SQLite to validate the next possible tail.
        const message = sanitizeHostErrorMessage((e as Error).message);
        results.push({
          type: "error",
          error: message,
        });
        if (data.options.bail) break;
        let tail = iterator.getRemainingSQL();
        if (tail === remainingSql)
          tail = tailAfterFailedPrepare(db, remainingSql) ?? remainingSql;
        if (tail === remainingSql) break;
        remainingSql = tail;
        continue;
      }
      const stmt = prepared.getSQL();
      try {
        const columns = prepared.getColumnNames();
        for (const column of columns) {
          resultBytes += Buffer.byteLength(column, "utf8");
        }
        const rows: unknown[][] = [];
        while (prepared.step()) {
          if (resultRows >= data.limits.maxResultRows) {
            throw new Error(
              `query result exceeds ${data.limits.maxResultRows} row limit`,
            );
          }
          const row = prepared.get();
          let rowBytes = row.length * 8;
          for (const value of row) rowBytes += valueByteLength(value);
          if (resultBytes + rowBytes > data.limits.maxResultBytes) {
            throw new Error(
              `query result exceeds ${data.limits.maxResultBytes} byte limit`,
            );
          }
          resultBytes += rowBytes;
          resultRows++;
          rows.push(row);
        }
        results.push({ type: "data", columns, rows });
        if (!isReadOnlyStatement(stmt)) hasModifications = true;
      } catch (e) {
        const message = sanitizeHostErrorMessage((e as Error).message);
        results.push({ type: "error", error: message });
        if (data.options.bail) {
          break;
        }
      } finally {
        prepared.free();
      }
    }

    let resultBuffer: Uint8Array | null = null;
    if (hasModifications) {
      const databaseBytes = databaseByteLength(db);
      if (databaseBytes > data.limits.maxDatabaseBytes) {
        throw new Error(
          `database exceeds ${data.limits.maxDatabaseBytes} byte limit`,
        );
      }
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
