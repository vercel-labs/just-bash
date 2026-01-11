import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("sqlite3", () => {
  describe("basic operations", () => {
    it("should create table and query data", async () => {
      const env = new Bash();
      const result = await env.exec(
        'sqlite3 :memory: "CREATE TABLE t(x INT); INSERT INTO t VALUES(1),(2),(3); SELECT * FROM t"',
      );
      expect(result.stdout).toBe("1\n2\n3\n");
      expect(result.exitCode).toBe(0);
    });

    it("should handle multiple columns", async () => {
      const env = new Bash();
      const result = await env.exec(
        "sqlite3 :memory: \"CREATE TABLE t(a INT, b TEXT); INSERT INTO t VALUES(1,'x'),(2,'y'); SELECT * FROM t\"",
      );
      expect(result.stdout).toBe("1|x\n2|y\n");
      expect(result.exitCode).toBe(0);
    });

    it("should show help with --help", async () => {
      const env = new Bash();
      const result = await env.exec("sqlite3 --help");
      expect(result.stdout).toContain("sqlite3");
      expect(result.stdout).toContain("DATABASE");
      expect(result.exitCode).toBe(0);
    });

    it("should show help with -help (single dash)", async () => {
      const env = new Bash();
      const result = await env.exec("sqlite3 -help");
      expect(result.stdout).toContain("sqlite3");
      expect(result.stdout).toContain("DATABASE");
      expect(result.exitCode).toBe(0);
    });

    it("should execute multiple statements", async () => {
      const env = new Bash();
      const result = await env.exec(
        'sqlite3 :memory: "CREATE TABLE a(x); CREATE TABLE b(y); INSERT INTO a VALUES(1); INSERT INTO b VALUES(2); SELECT * FROM a; SELECT * FROM b"',
      );
      expect(result.stdout).toBe("1\n2\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("file operations", () => {
    it("should create and read database file", async () => {
      const env = new Bash();
      await env.exec(
        "sqlite3 /test.db \"CREATE TABLE users(id INT, name TEXT); INSERT INTO users VALUES(1,'alice')\"",
      );
      const result = await env.exec('sqlite3 /test.db "SELECT * FROM users"');
      expect(result.stdout).toBe("1|alice\n");
      expect(result.exitCode).toBe(0);
    });

    it("should persist changes to database file", async () => {
      const env = new Bash();
      await env.exec('sqlite3 /data.db "CREATE TABLE t(x INT)"');
      await env.exec('sqlite3 /data.db "INSERT INTO t VALUES(1)"');
      await env.exec('sqlite3 /data.db "INSERT INTO t VALUES(2)"');
      const result = await env.exec('sqlite3 /data.db "SELECT * FROM t"');
      expect(result.stdout).toBe("1\n2\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("stdin input", () => {
    it("should read SQL from stdin", async () => {
      const env = new Bash();
      const result = await env.exec(
        'echo "CREATE TABLE t(x); INSERT INTO t VALUES(42); SELECT * FROM t" | sqlite3 :memory:',
      );
      expect(result.stdout).toBe("42\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("error handling", () => {
    it("should error on missing database argument", async () => {
      const env = new Bash();
      const result = await env.exec("sqlite3");
      expect(result.stderr).toContain("missing database argument");
      expect(result.exitCode).toBe(1);
    });

    it("should error on SQL syntax error", async () => {
      const env = new Bash();
      const result = await env.exec('sqlite3 :memory: "SELEC * FROM t"');
      expect(result.stdout).toContain("Error:");
      expect(result.exitCode).toBe(0);
    });

    it("should error on unknown option", async () => {
      const env = new Bash();
      const result = await env.exec('sqlite3 -unknown :memory: "SELECT 1"');
      expect(result.stderr).toBe(
        "sqlite3: Error: unknown option: -unknown\nUse -help for a list of options.\n",
      );
      expect(result.exitCode).toBe(1);
    });

    it("should error on missing table", async () => {
      const env = new Bash();
      const result = await env.exec(
        'sqlite3 :memory: "SELECT * FROM nonexistent"',
      );
      expect(result.stdout).toContain("no such table");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("data types", () => {
    it("should handle NULL values", async () => {
      const env = new Bash();
      const result = await env.exec(
        'sqlite3 -json :memory: "CREATE TABLE t(x); INSERT INTO t VALUES(NULL); SELECT * FROM t"',
      );
      expect(result.stdout).toBe('[{"x":null}]\n');
      expect(result.exitCode).toBe(0);
    });

    it("should handle integers and floats", async () => {
      const env = new Bash();
      const result = await env.exec(
        'sqlite3 -json :memory: "CREATE TABLE t(i INT, f REAL); INSERT INTO t VALUES(42, 3.14); SELECT * FROM t"',
      );
      // Full IEEE 754 precision like real sqlite3
      expect(result.stdout).toBe('[{"i":42,"f":3.1400000000000001}]\n');
      expect(result.exitCode).toBe(0);
    });
  });
});
