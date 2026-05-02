/**
 * Regression tests for the HIGH_BUG sqlite3 writeback finding.
 *
 * Previously the worker classified statements as "writes" with a
 * `startsWith` allowlist on INSERT/UPDATE/DELETE/CREATE/DROP/ALTER/
 * REPLACE/VACUUM. Statements that mutated the database but did NOT
 * begin with one of those tokens — CTE-prefixed writes (`WITH ...
 * INSERT/UPDATE/DELETE`), mutating PRAGMAs (`PRAGMA user_version=N`),
 * and comment-led writes — silently skipped the writeback to disk.
 *
 * Each test executes a mutating statement, then RE-OPENS the database
 * file in a fresh Bash environment to confirm the change persisted.
 * If the writeback gate misses the mutation, the second invocation
 * sees an unmutated database and the assertion fails.
 */
import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

async function setupDb(env: Bash, schema: string): Promise<void> {
  const result = await env.exec(`sqlite3 /tmp/db.sqlite "${schema}"`);
  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
}

describe("sqlite3 writeback covers non-prefixed mutations", () => {
  it("persists a CTE-prefixed INSERT (WITH ... INSERT)", async () => {
    const env = new Bash();
    await setupDb(env, "CREATE TABLE t(x INT); INSERT INTO t VALUES(1)");

    // Mutating WITH-prefixed write — startsWith allowlist would miss this.
    const write = await env.exec(
      `sqlite3 /tmp/db.sqlite "WITH cte AS (SELECT 2 AS v) INSERT INTO t SELECT v FROM cte"`,
    );
    expect(write.exitCode).toBe(0);
    expect(write.stderr).toBe("");

    // Re-open the persisted file and confirm the row is there.
    const read = await env.exec(
      `sqlite3 /tmp/db.sqlite "SELECT x FROM t ORDER BY x"`,
    );
    expect(read.exitCode).toBe(0);
    expect(read.stdout).toBe("1\n2\n");
  });

  it("persists a CTE-prefixed UPDATE", async () => {
    const env = new Bash();
    await setupDb(
      env,
      "CREATE TABLE t(id INT, val TEXT); INSERT INTO t VALUES(1,'a'),(2,'b')",
    );

    const write = await env.exec(
      `sqlite3 /tmp/db.sqlite "WITH ids AS (SELECT 1 AS id) UPDATE t SET val='changed' WHERE id IN (SELECT id FROM ids)"`,
    );
    expect(write.exitCode).toBe(0);
    expect(write.stderr).toBe("");

    const read = await env.exec(
      `sqlite3 /tmp/db.sqlite "SELECT id, val FROM t ORDER BY id"`,
    );
    expect(read.exitCode).toBe(0);
    expect(read.stdout).toBe("1|changed\n2|b\n");
  });

  it("persists a CTE-prefixed DELETE", async () => {
    const env = new Bash();
    await setupDb(
      env,
      "CREATE TABLE t(x INT); INSERT INTO t VALUES(1),(2),(3)",
    );

    const write = await env.exec(
      `sqlite3 /tmp/db.sqlite "WITH ids AS (SELECT 2 AS x) DELETE FROM t WHERE x IN (SELECT x FROM ids)"`,
    );
    expect(write.exitCode).toBe(0);
    expect(write.stderr).toBe("");

    const read = await env.exec(
      `sqlite3 /tmp/db.sqlite "SELECT x FROM t ORDER BY x"`,
    );
    expect(read.exitCode).toBe(0);
    expect(read.stdout).toBe("1\n3\n");
  });

  it("persists a mutating PRAGMA (user_version)", async () => {
    const env = new Bash();
    await setupDb(env, "CREATE TABLE t(x INT)");

    const write = await env.exec(
      `sqlite3 /tmp/db.sqlite "PRAGMA user_version = 42"`,
    );
    expect(write.exitCode).toBe(0);
    expect(write.stderr).toBe("");

    const read = await env.exec(`sqlite3 /tmp/db.sqlite "PRAGMA user_version"`);
    expect(read.exitCode).toBe(0);
    expect(read.stdout).toBe("42\n");
  });

  it("persists a comment-led INSERT (line comment)", async () => {
    const env = new Bash();
    await setupDb(env, "CREATE TABLE t(x INT)");

    // -- comment then INSERT. startsWith allowlist would miss this.
    // Pipe via stdin to preserve the embedded newline cleanly.
    const write = await env.exec(
      `printf '%s\\n%s' '-- adding a row' 'INSERT INTO t VALUES(7);' | sqlite3 /tmp/db.sqlite`,
    );
    expect(write.exitCode).toBe(0);
    expect(write.stderr).toBe("");

    const read = await env.exec(`sqlite3 /tmp/db.sqlite "SELECT x FROM t"`);
    expect(read.exitCode).toBe(0);
    expect(read.stdout).toBe("7\n");
  });

  it("persists a comment-led UPDATE (block comment)", async () => {
    const env = new Bash();
    await setupDb(
      env,
      "CREATE TABLE t(id INT, val TEXT); INSERT INTO t VALUES(1,'a')",
    );

    const write = await env.exec(
      `sqlite3 /tmp/db.sqlite "/* note */ UPDATE t SET val='b' WHERE id=1"`,
    );
    expect(write.exitCode).toBe(0);
    expect(write.stderr).toBe("");

    const read = await env.exec(
      `sqlite3 /tmp/db.sqlite "SELECT id, val FROM t"`,
    );
    expect(read.exitCode).toBe(0);
    expect(read.stdout).toBe("1|b\n");
  });

  it("does not mark a plain SELECT as modified (no needless writeback)", async () => {
    // Negative control: a pure SELECT must remain classified read-only,
    // otherwise we'd write back unnecessarily on every read.
    const env = new Bash();
    await setupDb(env, "CREATE TABLE t(x INT); INSERT INTO t VALUES(5)");

    const read = await env.exec(`sqlite3 /tmp/db.sqlite "SELECT x FROM t"`);
    expect(read.exitCode).toBe(0);
    expect(read.stdout).toBe("5\n");
  });
});
