import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";

/**
 * Comparison tests for parse errors
 * These tests verify that our virtual shell handles parse errors
 * similarly to real bash.
 */
describe("Parse Errors - Comparison Tests", () => {
  let tempDir: string;

  const runRealBash = (
    command: string,
  ): { stdout: string; stderr: string; exitCode: number } => {
    try {
      const stdout = execSync(command, {
        cwd: tempDir,
        shell: "/bin/bash",
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      return { stdout, stderr: "", exitCode: 0 };
    } catch (error: unknown) {
      const err = error as {
        stdout?: string;
        stderr?: string;
        status?: number;
      };
      return {
        stdout: err.stdout || "",
        stderr: err.stderr || "",
        exitCode: err.status || 1,
      };
    }
  };

  const runVirtualBash = async (
    command: string,
    files: Record<string, string> = {},
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> => {
    const env = new Bash({ files, cwd: "/" });
    return env.exec(command);
  };

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "bash-parse-errors-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("unknown command errors", () => {
    it("should return exit code 127 for unknown command", async () => {
      const realResult = runRealBash("nonexistentcommand123");
      const virtualResult = await runVirtualBash("nonexistentcommand123");

      expect(virtualResult.exitCode).toBe(realResult.exitCode);
      expect(virtualResult.exitCode).toBe(127);
    });

    it("should include command name in error message", async () => {
      const realResult = runRealBash("myunknowncommand");
      const virtualResult = await runVirtualBash("myunknowncommand");

      expect(virtualResult.stderr).toContain("myunknowncommand");
      expect(realResult.stderr).toContain("myunknowncommand");
    });
  });

  describe("file not found errors", () => {
    it("should return exit code 1 for cat on missing file", async () => {
      const realResult = runRealBash("cat /nonexistent_file_12345.txt");
      const virtualResult = await runVirtualBash(
        "cat /nonexistent_file_12345.txt",
      );

      expect(virtualResult.exitCode).toBe(realResult.exitCode);
      expect(virtualResult.exitCode).toBe(1);
    });

    it("should return exit code 1 for grep on missing file", async () => {
      const realResult = runRealBash(
        "grep pattern /nonexistent_file_12345.txt",
      );
      const virtualResult = await runVirtualBash(
        "grep pattern /nonexistent_file_12345.txt",
      );

      expect(virtualResult.exitCode).toBe(realResult.exitCode);
    });
  });

  describe("for loop syntax", () => {
    it("should execute valid for loop", async () => {
      const realResult = runRealBash("for i in a b c; do echo $i; done");
      const virtualResult = await runVirtualBash(
        "for i in a b c; do echo $i; done",
      );

      expect(virtualResult.stdout).toBe(realResult.stdout);
      expect(virtualResult.exitCode).toBe(realResult.exitCode);
    });

    it("should handle empty list in for loop", async () => {
      const realResult = runRealBash("for i in; do echo $i; done");
      const virtualResult = await runVirtualBash("for i in; do echo $i; done");

      expect(virtualResult.stdout).toBe(realResult.stdout);
      expect(virtualResult.exitCode).toBe(realResult.exitCode);
    });
  });

  describe("while loop syntax", () => {
    it("should execute while false (zero iterations)", async () => {
      const realResult = runRealBash("while false; do echo loop; done");
      const virtualResult = await runVirtualBash(
        "while false; do echo loop; done",
      );

      expect(virtualResult.stdout).toBe(realResult.stdout);
      expect(virtualResult.exitCode).toBe(realResult.exitCode);
    });
  });

  describe("until loop syntax", () => {
    it("should execute until true (zero iterations)", async () => {
      const realResult = runRealBash("until true; do echo loop; done");
      const virtualResult = await runVirtualBash(
        "until true; do echo loop; done",
      );

      expect(virtualResult.stdout).toBe(realResult.stdout);
      expect(virtualResult.exitCode).toBe(realResult.exitCode);
    });
  });

  describe("if statement syntax", () => {
    it("should execute if true branch", async () => {
      const realResult = runRealBash("if true; then echo yes; fi");
      const virtualResult = await runVirtualBash("if true; then echo yes; fi");

      expect(virtualResult.stdout).toBe(realResult.stdout);
      expect(virtualResult.exitCode).toBe(realResult.exitCode);
    });

    it("should execute else branch when condition false", async () => {
      const realResult = runRealBash(
        "if false; then echo yes; else echo no; fi",
      );
      const virtualResult = await runVirtualBash(
        "if false; then echo yes; else echo no; fi",
      );

      expect(virtualResult.stdout).toBe(realResult.stdout);
      expect(virtualResult.exitCode).toBe(realResult.exitCode);
    });

    it("should execute elif branch", async () => {
      const realResult = runRealBash(
        "if false; then echo 1; elif true; then echo 2; else echo 3; fi",
      );
      const virtualResult = await runVirtualBash(
        "if false; then echo 1; elif true; then echo 2; else echo 3; fi",
      );

      expect(virtualResult.stdout).toBe(realResult.stdout);
      expect(virtualResult.exitCode).toBe(realResult.exitCode);
    });
  });

  describe("exit codes", () => {
    it("should return specified exit code", async () => {
      const realResult = runRealBash("exit 42");
      const virtualResult = await runVirtualBash("exit 42");

      expect(virtualResult.exitCode).toBe(realResult.exitCode);
      expect(virtualResult.exitCode).toBe(42);
    });

    it("should return 0 for successful command", async () => {
      const realResult = runRealBash("true");
      const virtualResult = await runVirtualBash("true");

      expect(virtualResult.exitCode).toBe(realResult.exitCode);
      expect(virtualResult.exitCode).toBe(0);
    });

    it("should return 1 for false command", async () => {
      const realResult = runRealBash("false");
      const virtualResult = await runVirtualBash("false");

      expect(virtualResult.exitCode).toBe(realResult.exitCode);
      expect(virtualResult.exitCode).toBe(1);
    });
  });

  describe("operator behavior", () => {
    it("should short-circuit && on failure", async () => {
      const realResult = runRealBash("false && echo never");
      const virtualResult = await runVirtualBash("false && echo never");

      expect(virtualResult.stdout).toBe(realResult.stdout);
      expect(virtualResult.exitCode).toBe(realResult.exitCode);
    });

    it("should short-circuit || on success", async () => {
      const realResult = runRealBash("true || echo never");
      const virtualResult = await runVirtualBash("true || echo never");

      expect(virtualResult.stdout).toBe(realResult.stdout);
      expect(virtualResult.exitCode).toBe(realResult.exitCode);
    });

    it("should execute || fallback on failure", async () => {
      const realResult = runRealBash("false || echo fallback");
      const virtualResult = await runVirtualBash("false || echo fallback");

      expect(virtualResult.stdout).toBe(realResult.stdout);
      expect(virtualResult.exitCode).toBe(realResult.exitCode);
    });

    it("should execute both with semicolon regardless of exit code", async () => {
      const realResult = runRealBash("false; echo after");
      const virtualResult = await runVirtualBash("false; echo after");

      expect(virtualResult.stdout).toBe(realResult.stdout);
    });
  });

  describe("quoting behavior", () => {
    it("should preserve spaces in double quotes", async () => {
      const realResult = runRealBash('echo "hello   world"');
      const virtualResult = await runVirtualBash('echo "hello   world"');

      expect(virtualResult.stdout).toBe(realResult.stdout);
    });

    it("should preserve spaces in single quotes", async () => {
      const realResult = runRealBash("echo 'hello   world'");
      const virtualResult = await runVirtualBash("echo 'hello   world'");

      expect(virtualResult.stdout).toBe(realResult.stdout);
    });

    it("should not expand variables in single quotes", async () => {
      const realResult = runRealBash("export X=value; echo '$X'");
      const virtualResult = await runVirtualBash("export X=value; echo '$X'");

      expect(virtualResult.stdout).toBe(realResult.stdout);
      expect(virtualResult.stdout).toBe("$X\n");
    });
  });

  describe("empty and whitespace commands", () => {
    it("should handle empty command", async () => {
      // Note: execSync with empty command throws error, but bash -c '' returns 0
      // Our virtual shell matches real bash behavior (exit code 0)
      const virtualResult = await runVirtualBash("");

      expect(virtualResult.exitCode).toBe(0);
      expect(virtualResult.stdout).toBe("");
    });

    it("should handle whitespace-only command", async () => {
      const realResult = runRealBash("   ");
      const virtualResult = await runVirtualBash("   ");

      expect(virtualResult.exitCode).toBe(realResult.exitCode);
    });

    it("should handle multiple semicolons as syntax error", async () => {
      // In bash, ;; is a case statement delimiter, so ;;; is a syntax error
      const realResult = runRealBash("echo a;;;echo b");
      const virtualResult = await runVirtualBash("echo a;;;echo b");

      // Both real bash and our shell should return exit code 2 for syntax error
      expect(realResult.exitCode).toBe(2);
      expect(virtualResult.exitCode).toBe(2);
    });
  });
});
