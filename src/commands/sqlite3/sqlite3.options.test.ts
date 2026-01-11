import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("sqlite3 options", () => {
  describe("-version", () => {
    it("should show SQLite version", async () => {
      const env = new Bash();
      const result = await env.exec("sqlite3 -version");
      expect(result.stdout).toMatch(/^\d+\.\d+\.\d+/);
      expect(result.exitCode).toBe(0);
    });
  });

  describe("-- end of options", () => {
    it("should treat arguments after -- as positional", async () => {
      const env = new Bash();
      const result = await env.exec('sqlite3 :memory: -- "SELECT 1 as value"');
      expect(result.stdout).toBe("1\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("-newline", () => {
    it("should use custom row separator", async () => {
      const env = new Bash();
      const result = await env.exec(
        "sqlite3 -newline '|' :memory: \"CREATE TABLE t(x); INSERT INTO t VALUES(1),(2),(3); SELECT * FROM t\"",
      );
      expect(result.stdout).toBe("1|2|3|");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("-echo", () => {
    it("should print SQL before execution", async () => {
      const env = new Bash();
      const result = await env.exec(
        'sqlite3 -echo :memory: "SELECT 1; SELECT 2"',
      );
      expect(result.stdout).toContain("SELECT 1; SELECT 2");
      expect(result.stdout).toContain("1");
      expect(result.stdout).toContain("2");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("-cmd", () => {
    it("should run SQL command before main SQL", async () => {
      const env = new Bash();
      const result = await env.exec(
        'sqlite3 -cmd "CREATE TABLE t(x); INSERT INTO t VALUES(42)" :memory: "SELECT * FROM t"',
      );
      expect(result.stdout).toBe("42\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("-header / -noheader", () => {
    it("should show headers with -header", async () => {
      const env = new Bash();
      const result = await env.exec(
        "sqlite3 -header :memory: \"CREATE TABLE t(col1 INT, col2 TEXT); INSERT INTO t VALUES(1,'a'); SELECT * FROM t\"",
      );
      expect(result.stdout).toBe("col1|col2\n1|a\n");
      expect(result.exitCode).toBe(0);
    });

    it("should hide headers with -noheader", async () => {
      const env = new Bash();
      const result = await env.exec(
        'sqlite3 -noheader :memory: "CREATE TABLE t(x INT); INSERT INTO t VALUES(1); SELECT * FROM t"',
      );
      expect(result.stdout).toBe("1\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("-separator", () => {
    it("should use custom separator", async () => {
      const env = new Bash();
      const result = await env.exec(
        'sqlite3 -separator "," :memory: "CREATE TABLE t(a,b); INSERT INTO t VALUES(1,2); SELECT * FROM t"',
      );
      expect(result.stdout).toBe("1,2\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("-nullvalue", () => {
    it("should display custom null value", async () => {
      const env = new Bash();
      const result = await env.exec(
        'sqlite3 -nullvalue "NULL" :memory: "CREATE TABLE t(x); INSERT INTO t VALUES(1),(NULL); SELECT * FROM t"',
      );
      expect(result.stdout).toBe("1\nNULL\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("-readonly", () => {
    it("should not persist changes with -readonly", async () => {
      const env = new Bash();
      await env.exec(
        'sqlite3 /ro.db "CREATE TABLE t(x INT); INSERT INTO t VALUES(1)"',
      );
      await env.exec('sqlite3 -readonly /ro.db "INSERT INTO t VALUES(2)"');
      const result = await env.exec('sqlite3 /ro.db "SELECT * FROM t"');
      expect(result.stdout).toBe("1\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("-bail", () => {
    it("should stop on first error with -bail", async () => {
      const env = new Bash();
      const result = await env.exec(
        'sqlite3 -bail :memory: "SELECT * FROM bad; SELECT 1"',
      );
      expect(result.stderr).toContain("no such table");
      expect(result.stdout).not.toContain("1");
      expect(result.exitCode).toBe(1);
    });
  });
});
