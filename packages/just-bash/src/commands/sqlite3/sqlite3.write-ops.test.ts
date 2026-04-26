import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("sqlite3 write operations", () => {
  describe("UPDATE", () => {
    it("should update rows", async () => {
      const env = new Bash();
      const result = await env.exec(
        "sqlite3 :memory: \"CREATE TABLE t(id INT, val TEXT); INSERT INTO t VALUES(1,'a'),(2,'b'); UPDATE t SET val='x' WHERE id=1; SELECT * FROM t ORDER BY id\"",
      );
      expect(result.stdout).toBe("1|x\n2|b\n");
      expect(result.exitCode).toBe(0);
    });

    it("should update all rows without WHERE", async () => {
      const env = new Bash();
      const result = await env.exec(
        'sqlite3 :memory: "CREATE TABLE t(x INT); INSERT INTO t VALUES(1),(2),(3); UPDATE t SET x=0; SELECT * FROM t"',
      );
      expect(result.stdout).toBe("0\n0\n0\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("DELETE", () => {
    it("should delete specific rows", async () => {
      const env = new Bash();
      const result = await env.exec(
        'sqlite3 :memory: "CREATE TABLE t(x INT); INSERT INTO t VALUES(1),(2),(3); DELETE FROM t WHERE x=2; SELECT * FROM t ORDER BY x"',
      );
      expect(result.stdout).toBe("1\n3\n");
      expect(result.exitCode).toBe(0);
    });

    it("should delete all rows without WHERE", async () => {
      const env = new Bash();
      const result = await env.exec(
        'sqlite3 :memory: "CREATE TABLE t(x INT); INSERT INTO t VALUES(1),(2); DELETE FROM t; SELECT COUNT(*) FROM t"',
      );
      expect(result.stdout).toBe("0\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("DROP TABLE", () => {
    it("should drop table", async () => {
      const env = new Bash();
      const result = await env.exec(
        "sqlite3 :memory: \"CREATE TABLE t(x); DROP TABLE t; SELECT name FROM sqlite_master WHERE type='table'\"",
      );
      expect(result.stdout).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("should error when querying dropped table", async () => {
      const env = new Bash();
      const result = await env.exec(
        'sqlite3 :memory: "CREATE TABLE t(x); DROP TABLE t; SELECT * FROM t"',
      );
      expect(result.stdout).toContain("no such table");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("ALTER TABLE", () => {
    it("should rename table", async () => {
      const env = new Bash();
      const result = await env.exec(
        "sqlite3 :memory: \"CREATE TABLE old(x); ALTER TABLE old RENAME TO new; SELECT name FROM sqlite_master WHERE type='table'\"",
      );
      expect(result.stdout).toBe("new\n");
      expect(result.exitCode).toBe(0);
    });

    it("should add column", async () => {
      const env = new Bash();
      const result = await env.exec(
        "sqlite3 :memory: \"CREATE TABLE t(a INT); INSERT INTO t VALUES(1); ALTER TABLE t ADD COLUMN b TEXT DEFAULT 'x'; SELECT * FROM t\"",
      );
      expect(result.stdout).toBe("1|x\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("REPLACE INTO", () => {
    it("should replace existing row on conflict", async () => {
      const env = new Bash();
      const result = await env.exec(
        "sqlite3 :memory: \"CREATE TABLE t(id INTEGER PRIMARY KEY, val TEXT); INSERT INTO t VALUES(1,'a'); REPLACE INTO t VALUES(1,'b'); SELECT * FROM t\"",
      );
      expect(result.stdout).toBe("1|b\n");
      expect(result.exitCode).toBe(0);
    });

    it("should insert new row when no conflict", async () => {
      const env = new Bash();
      const result = await env.exec(
        "sqlite3 :memory: \"CREATE TABLE t(id INTEGER PRIMARY KEY, val TEXT); INSERT INTO t VALUES(1,'a'); REPLACE INTO t VALUES(2,'b'); SELECT * FROM t ORDER BY id\"",
      );
      expect(result.stdout).toBe("1|a\n2|b\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("persistence to file", () => {
    it("should persist UPDATE to file", async () => {
      const env = new Bash();
      await env.exec(
        'sqlite3 /test.db "CREATE TABLE t(x INT); INSERT INTO t VALUES(1)"',
      );
      await env.exec('sqlite3 /test.db "UPDATE t SET x=99"');
      const result = await env.exec('sqlite3 /test.db "SELECT * FROM t"');
      expect(result.stdout).toBe("99\n");
    });

    it("should persist DELETE to file", async () => {
      const env = new Bash();
      await env.exec(
        'sqlite3 /test.db "CREATE TABLE t(x INT); INSERT INTO t VALUES(1),(2),(3)"',
      );
      await env.exec('sqlite3 /test.db "DELETE FROM t WHERE x=2"');
      const result = await env.exec(
        'sqlite3 /test.db "SELECT * FROM t ORDER BY x"',
      );
      expect(result.stdout).toBe("1\n3\n");
    });

    it("should persist DROP TABLE to file", async () => {
      const env = new Bash();
      await env.exec(
        'sqlite3 /test.db "CREATE TABLE t1(x); CREATE TABLE t2(y)"',
      );
      await env.exec('sqlite3 /test.db "DROP TABLE t1"');
      const result = await env.exec(
        "sqlite3 /test.db \"SELECT name FROM sqlite_master WHERE type='table' ORDER BY name\"",
      );
      expect(result.stdout).toBe("t2\n");
    });

    it("should create new database file on first write", async () => {
      const env = new Bash();
      await env.exec(
        'sqlite3 /newdb.db "CREATE TABLE t(x); INSERT INTO t VALUES(42)"',
      );
      const result = await env.exec('sqlite3 /newdb.db "SELECT * FROM t"');
      expect(result.stdout).toBe("42\n");
      expect(result.exitCode).toBe(0);
    });
  });
});
