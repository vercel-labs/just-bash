import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("sqlite3 error handling", () => {
  describe("missing option arguments", () => {
    it("should error when -separator is last argument", async () => {
      const env = new Bash();
      const result = await env.exec("sqlite3 :memory: -separator");
      expect(result.stderr).toBe(
        "sqlite3: Error: missing argument to -separator\n",
      );
      expect(result.exitCode).toBe(1);
    });

    it("should error when -newline is last argument", async () => {
      const env = new Bash();
      const result = await env.exec("sqlite3 :memory: -newline");
      expect(result.stderr).toBe(
        "sqlite3: Error: missing argument to -newline\n",
      );
      expect(result.exitCode).toBe(1);
    });

    it("should error when -nullvalue is last argument", async () => {
      const env = new Bash();
      const result = await env.exec("sqlite3 :memory: -nullvalue");
      expect(result.stderr).toBe(
        "sqlite3: Error: missing argument to -nullvalue\n",
      );
      expect(result.exitCode).toBe(1);
    });

    it("should error when -cmd is last argument", async () => {
      const env = new Bash();
      const result = await env.exec("sqlite3 :memory: -cmd");
      expect(result.stderr).toBe("sqlite3: Error: missing argument to -cmd\n");
      expect(result.exitCode).toBe(1);
    });
  });

  describe("missing required arguments", () => {
    it("should error when no SQL provided", async () => {
      const env = new Bash();
      const result = await env.exec("sqlite3 :memory:");
      expect(result.stderr).toContain("no SQL provided");
      expect(result.exitCode).toBe(1);
    });

    it("should error when no database argument", async () => {
      const env = new Bash();
      const result = await env.exec("sqlite3");
      expect(result.stderr).toContain("missing database argument");
      expect(result.exitCode).toBe(1);
    });
  });

  describe("SQL errors without -bail", () => {
    it("should continue after error and return exit code 0", async () => {
      const env = new Bash();
      const result = await env.exec(
        'sqlite3 :memory: "SELECT * FROM nonexistent; SELECT 42"',
      );
      expect(result.stdout).toContain("Error:");
      expect(result.stdout).toContain("no such table");
      expect(result.stdout).toContain("42");
      expect(result.exitCode).toBe(0);
    });

    it("should handle multiple errors", async () => {
      const env = new Bash();
      const result = await env.exec(
        'sqlite3 :memory: "SELECT * FROM bad1; SELECT * FROM bad2; SELECT 1"',
      );
      expect(result.stdout).toMatch(/Error:.*bad1/);
      expect(result.stdout).toMatch(/Error:.*bad2/);
      expect(result.stdout).toContain("1");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("SQL errors with -bail", () => {
    it("should stop on first error and return exit code 1", async () => {
      const env = new Bash();
      const result = await env.exec(
        'sqlite3 -bail :memory: "SELECT * FROM bad1; SELECT * FROM bad2"',
      );
      expect(result.stderr).toContain("bad1");
      expect(result.stderr).not.toContain("bad2");
      expect(result.exitCode).toBe(1);
    });

    it("should include partial output before error", async () => {
      const env = new Bash();
      const result = await env.exec(
        'sqlite3 -bail :memory: "SELECT 1; SELECT * FROM bad; SELECT 2"',
      );
      expect(result.stdout).toContain("1");
      expect(result.stdout).not.toContain("2");
      expect(result.exitCode).toBe(1);
    });
  });

  describe("invalid options", () => {
    it("should error on unknown short option", async () => {
      const env = new Bash();
      const result = await env.exec('sqlite3 -xyz :memory: "SELECT 1"');
      expect(result.stderr).toBe(
        "sqlite3: Error: unknown option: -xyz\nUse -help for a list of options.\n",
      );
      expect(result.exitCode).toBe(1);
    });

    it("should error on unknown option starting with double dash", async () => {
      const env = new Bash();
      const result = await env.exec('sqlite3 --xyz :memory: "SELECT 1"');
      // Real sqlite3 treats --xyz as -xyz
      expect(result.stderr).toBe(
        "sqlite3: Error: unknown option: -xyz\nUse -help for a list of options.\n",
      );
      expect(result.exitCode).toBe(1);
    });
  });
});
