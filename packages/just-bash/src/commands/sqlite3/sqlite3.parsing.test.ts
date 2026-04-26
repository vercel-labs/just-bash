import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("sqlite3 SQL parsing", () => {
  describe("statement splitting", () => {
    it("should handle semicolon inside single-quoted string", async () => {
      const env = new Bash();
      const result = await env.exec(
        "sqlite3 :memory: \"CREATE TABLE t(x); INSERT INTO t VALUES('a;b'); SELECT * FROM t\"",
      );
      expect(result.stdout).toBe("a;b\n");
      expect(result.exitCode).toBe(0);
    });

    it("should handle semicolon inside double-quoted identifier", async () => {
      const env = new Bash();
      // In SQLite, double quotes are for identifiers, not strings
      // This test verifies we handle semicolons in double-quoted identifiers
      const result = await env.exec(
        'sqlite3 :memory: "CREATE TABLE t(\\"col;name\\" TEXT); INSERT INTO t VALUES(\'test\'); SELECT * FROM t"',
      );
      expect(result.stdout).toBe("test\n");
      expect(result.exitCode).toBe(0);
    });

    it("should handle multiple semicolons in string", async () => {
      const env = new Bash();
      const result = await env.exec(
        "sqlite3 :memory: \"CREATE TABLE t(x); INSERT INTO t VALUES('a;b;c;d'); SELECT * FROM t\"",
      );
      expect(result.stdout).toBe("a;b;c;d\n");
      expect(result.exitCode).toBe(0);
    });

    it("should handle statement without trailing semicolon", async () => {
      const env = new Bash();
      const result = await env.exec('sqlite3 :memory: "SELECT 1"');
      expect(result.stdout).toBe("1\n");
      expect(result.exitCode).toBe(0);
    });

    it("should handle empty statements (multiple semicolons)", async () => {
      const env = new Bash();
      const result = await env.exec('sqlite3 :memory: "SELECT 1;;; SELECT 2"');
      expect(result.stdout).toBe("1\n2\n");
      expect(result.exitCode).toBe(0);
    });

    it("should handle whitespace-only between statements", async () => {
      const env = new Bash();
      const result = await env.exec(
        'sqlite3 :memory: "SELECT 1;   \n   SELECT 2"',
      );
      expect(result.stdout).toBe("1\n2\n");
      expect(result.exitCode).toBe(0);
    });

    it("should handle SQL doubled-quote escaping with semicolons", async () => {
      // This tests the SQL '' escaping - the semicolon inside should NOT split
      const env = new Bash();
      const result = await env.exec(
        "sqlite3 :memory: \"CREATE TABLE t(x); INSERT INTO t VALUES('it''s;weird'); SELECT * FROM t\"",
      );
      expect(result.stdout).toBe("it's;weird\n");
      expect(result.exitCode).toBe(0);
    });

    it("should handle multiple SQL doubled quotes with semicolon", async () => {
      // Multiple '' escapes, semicolon inside should NOT split
      const env = new Bash();
      const result = await env.exec(
        "sqlite3 :memory: \"CREATE TABLE t(x); INSERT INTO t VALUES('a''b;c''d'); SELECT * FROM t\"",
      );
      expect(result.stdout).toBe("a'b;c'd\n");
      expect(result.exitCode).toBe(0);
    });

    it("should handle doubled quote at end of string followed by semicolon", async () => {
      // Edge case: '' at end of string, then semicolon outside
      const env = new Bash();
      const result = await env.exec(
        "sqlite3 :memory: \"CREATE TABLE t(x); INSERT INTO t VALUES('test'''); SELECT * FROM t\"",
      );
      expect(result.stdout).toBe("test'\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("quoted values", () => {
    it("should handle escaped single quotes in SQLite style", async () => {
      const env = new Bash();
      const result = await env.exec(
        "sqlite3 :memory: \"CREATE TABLE t(x); INSERT INTO t VALUES('it''s'); SELECT * FROM t\"",
      );
      expect(result.stdout).toBe("it's\n");
      expect(result.exitCode).toBe(0);
    });

    it("should handle empty string", async () => {
      const env = new Bash();
      const result = await env.exec(
        "sqlite3 :memory: \"CREATE TABLE t(x); INSERT INTO t VALUES(''); SELECT * FROM t\"",
      );
      expect(result.stdout).toBe("\n");
      expect(result.exitCode).toBe(0);
    });

    it("should handle string with newlines", async () => {
      const env = new Bash();
      const result = await env.exec(
        "sqlite3 :memory: \"CREATE TABLE t(x); INSERT INTO t VALUES('line1\nline2'); SELECT * FROM t\"",
      );
      expect(result.stdout).toBe("line1\nline2\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("edge cases", () => {
    it("should handle single statement", async () => {
      const env = new Bash();
      const result = await env.exec('sqlite3 :memory: "SELECT 42"');
      expect(result.stdout).toBe("42\n");
      expect(result.exitCode).toBe(0);
    });

    it("should handle many statements", async () => {
      const env = new Bash();
      const result = await env.exec(
        'sqlite3 :memory: "SELECT 1; SELECT 2; SELECT 3; SELECT 4; SELECT 5"',
      );
      expect(result.stdout).toBe("1\n2\n3\n4\n5\n");
      expect(result.exitCode).toBe(0);
    });

    it("should handle complex query with subquery", async () => {
      const env = new Bash();
      const result = await env.exec(
        'sqlite3 :memory: "SELECT * FROM (SELECT 1 as x UNION SELECT 2) ORDER BY x"',
      );
      expect(result.stdout).toBe("1\n2\n");
      expect(result.exitCode).toBe(0);
    });

    it("should handle CASE expression", async () => {
      const env = new Bash();
      const result = await env.exec(
        "sqlite3 :memory: \"SELECT CASE WHEN 1=1 THEN 'yes' ELSE 'no' END\"",
      );
      expect(result.stdout).toBe("yes\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("result sets", () => {
    it("should handle empty result set", async () => {
      const env = new Bash();
      const result = await env.exec(
        'sqlite3 :memory: "CREATE TABLE t(x); SELECT * FROM t"',
      );
      expect(result.stdout).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("should show header for empty result set with -header", async () => {
      const env = new Bash();
      const result = await env.exec(
        'sqlite3 -header :memory: "CREATE TABLE t(a INT, b TEXT); SELECT * FROM t"',
      );
      expect(result.stdout).toBe("a|b\n");
      expect(result.exitCode).toBe(0);
    });

    it("should handle single column result", async () => {
      const env = new Bash();
      const result = await env.exec(
        'sqlite3 :memory: "CREATE TABLE t(x); INSERT INTO t VALUES(1),(2); SELECT x FROM t"',
      );
      expect(result.stdout).toBe("1\n2\n");
      expect(result.exitCode).toBe(0);
    });

    it("should handle many columns", async () => {
      const env = new Bash();
      const result = await env.exec(
        'sqlite3 :memory: "SELECT 1,2,3,4,5,6,7,8,9,10"',
      );
      expect(result.stdout).toBe("1|2|3|4|5|6|7|8|9|10\n");
      expect(result.exitCode).toBe(0);
    });

    it("should handle single row", async () => {
      const env = new Bash();
      const result = await env.exec('sqlite3 :memory: "SELECT 42 as answer"');
      expect(result.stdout).toBe("42\n");
      expect(result.exitCode).toBe(0);
    });
  });
});
