import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("sqlite3 output modes", () => {
  describe("basic modes", () => {
    it("should output CSV with -csv", async () => {
      const env = new Bash();
      const result = await env.exec(
        "sqlite3 -csv :memory: \"CREATE TABLE t(a,b); INSERT INTO t VALUES(1,'hello'),(2,'world'); SELECT * FROM t\"",
      );
      expect(result.stdout).toBe("1,hello\n2,world\n");
      expect(result.exitCode).toBe(0);
    });

    it("should escape CSV fields properly", async () => {
      const env = new Bash();
      const result = await env.exec(
        "sqlite3 -csv :memory: \"CREATE TABLE t(a); INSERT INTO t VALUES('hello,world'),('has\nnewline'); SELECT * FROM t\"",
      );
      expect(result.stdout).toBe('"hello,world"\n"has\nnewline"\n');
      expect(result.exitCode).toBe(0);
    });

    it("should output JSON with -json", async () => {
      const env = new Bash();
      const result = await env.exec(
        "sqlite3 -json :memory: \"CREATE TABLE t(id INT, name TEXT); INSERT INTO t VALUES(1,'alice'),(2,'bob'); SELECT * FROM t\"",
      );
      expect(result.stdout).toBe(
        '[{"id":1,"name":"alice"},\n{"id":2,"name":"bob"}]\n',
      );
      expect(result.exitCode).toBe(0);
    });

    it("should output line mode with -line", async () => {
      const env = new Bash();
      const result = await env.exec(
        "sqlite3 -line :memory: \"CREATE TABLE t(a INT, b TEXT); INSERT INTO t VALUES(1,'x'); SELECT * FROM t\"",
      );
      expect(result.stdout).toBe("    a = 1\n    b = x\n");
      expect(result.exitCode).toBe(0);
    });

    it("should output column mode with -column", async () => {
      const env = new Bash();
      const result = await env.exec(
        "sqlite3 -column -header :memory: \"CREATE TABLE t(id INT, name TEXT); INSERT INTO t VALUES(1,'alice'); SELECT * FROM t\"",
      );
      expect(result.stdout).toContain("id");
      expect(result.stdout).toContain("name");
      expect(result.stdout).toContain("alice");
      expect(result.exitCode).toBe(0);
    });

    it("should output table mode with -table", async () => {
      const env = new Bash();
      const result = await env.exec(
        'sqlite3 -table -header :memory: "CREATE TABLE t(a INT); INSERT INTO t VALUES(1); SELECT * FROM t"',
      );
      expect(result.stdout).toContain("+");
      expect(result.stdout).toContain("|");
      expect(result.exitCode).toBe(0);
    });

    it("should output markdown with -markdown", async () => {
      const env = new Bash();
      const result = await env.exec(
        "sqlite3 -markdown -header :memory: \"CREATE TABLE t(a INT, b TEXT); INSERT INTO t VALUES(1,'x'); SELECT * FROM t\"",
      );
      expect(result.stdout).toContain("| a | b |");
      expect(result.stdout).toContain("|---|---|");
      expect(result.stdout).toContain("| 1 | x |");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("tabs mode", () => {
    it("should output tab-separated values with -tabs", async () => {
      const env = new Bash();
      const result = await env.exec(
        'sqlite3 -tabs :memory: "CREATE TABLE t(a,b); INSERT INTO t VALUES(1,2),(3,4); SELECT * FROM t"',
      );
      expect(result.stdout).toBe("1\t2\n3\t4\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("box mode", () => {
    it("should output Unicode box drawing with -box", async () => {
      const env = new Bash();
      const result = await env.exec(
        "sqlite3 -box :memory: \"CREATE TABLE t(id INT, name TEXT); INSERT INTO t VALUES(1,'alice'),(2,'bob'); SELECT * FROM t\"",
      );
      expect(result.stdout).toContain("┌");
      expect(result.stdout).toContain("│");
      expect(result.stdout).toContain("└");
      expect(result.stdout).toContain("id");
      expect(result.stdout).toContain("alice");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("quote mode", () => {
    it("should output SQL-style quoted values with -quote", async () => {
      const env = new Bash();
      const result = await env.exec(
        "sqlite3 -quote :memory: \"CREATE TABLE t(a INT, b TEXT); INSERT INTO t VALUES(1,'hello'),(NULL,'world'); SELECT * FROM t\"",
      );
      expect(result.stdout).toBe("1,'hello'\nNULL,'world'\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("html mode", () => {
    it("should output HTML table rows with -html", async () => {
      const env = new Bash();
      const result = await env.exec(
        "sqlite3 -html :memory: \"CREATE TABLE t(id INT, name TEXT); INSERT INTO t VALUES(1,'alice'); SELECT * FROM t\"",
      );
      expect(result.stdout).toContain("<TR>");
      expect(result.stdout).toContain("<TD>1</TD>");
      expect(result.stdout).toContain("<TD>alice</TD>");
      expect(result.stdout).toContain("</TR>");
      expect(result.exitCode).toBe(0);
    });

    it("should escape HTML entities", async () => {
      const env = new Bash();
      const result = await env.exec(
        "sqlite3 -html :memory: \"CREATE TABLE t(x); INSERT INTO t VALUES('<script>'); SELECT * FROM t\"",
      );
      expect(result.stdout).toContain("&lt;script&gt;");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("ascii mode", () => {
    it("should output with ASCII control characters", async () => {
      const env = new Bash();
      const result = await env.exec(
        'sqlite3 -ascii :memory: "CREATE TABLE t(a,b); INSERT INTO t VALUES(1,2),(3,4); SELECT * FROM t"',
      );
      // ASCII mode uses 0x1F (unit separator) between columns and 0x1E (record separator) between rows
      expect(result.stdout).toContain("1");
      expect(result.stdout).toContain("2");
      expect(result.stdout).toContain(String.fromCharCode(0x1f));
      expect(result.stdout).toContain(String.fromCharCode(0x1e));
      expect(result.exitCode).toBe(0);
    });
  });
});
