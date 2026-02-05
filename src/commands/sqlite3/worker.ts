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
import {
  WorkerDefenseInDepth,
  type WorkerDefenseStats,
} from "../../security/index.js";

// Cached SQL.js module (initialized once)
let cachedSQL: SqlJsStatic | null = null;

// Defense instance (activated after sql.js init)
let defense: WorkerDefenseInDepth | null = null;

/**
 * Initialize sql.js and activate defense-in-depth.
 * Called once per worker lifetime.
 */
async function initializeWithDefense(): Promise<SqlJsStatic> {
  if (cachedSQL) {
    return cachedSQL;
  }

  // Initialize sql.js WASM first (needs unrestricted JS features)
  cachedSQL = await initSqlJs();

  // Activate defense after sql.js is loaded (no exclusions needed)
  defense = new WorkerDefenseInDepth({
    onViolation: (v) => {
      parentPort?.postMessage({ type: "security-violation", violation: v });
    },
  });

  return cachedSQL;
}

export interface WorkerInput {
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

function isWriteStatement(sql: string): boolean {
  const trimmed = sql.trim().toUpperCase();
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
    const SQL = await initializeWithDefense();

    if (data.dbBuffer) {
      db = new SQL.Database(data.dbBuffer);
    } else {
      db = new SQL.Database();
    }
  } catch (e) {
    return {
      success: false,
      error: (e as Error).message,
      defenseStats: defense?.getStats(),
    };
  }

  const results: StatementResult[] = [];
  let hasModifications = false;

  try {
    const statements = splitStatements(data.sql);

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
    return {
      success: false,
      error: (e as Error).message,
      defenseStats: defense?.getStats(),
    };
  }
}

// Execute when run as worker
if (parentPort && workerData) {
  executeQuery(workerData as WorkerInput).then((result) => {
    parentPort?.postMessage(result);
  });
}
