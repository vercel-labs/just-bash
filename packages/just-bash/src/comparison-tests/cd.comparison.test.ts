import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanupTestDir,
  createTestDir,
  runRealBash,
  setupFiles,
} from "./fixture-runner.js";

describe("cd command - Real Bash Comparison", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  describe("basic cd", () => {
    it("should change directory and pwd should reflect it", async () => {
      const env = await setupFiles(testDir, {
        "subdir/file.txt": "content",
      });

      // Test cd followed by pwd in BashEnv
      const envResult = await env.exec("cd subdir && pwd");
      const realResult = await runRealBash("cd subdir && pwd", testDir);

      // Both should end with /subdir
      expect(envResult.stdout.trim().endsWith("/subdir")).toBe(true);
      expect(realResult.stdout.trim().endsWith("/subdir")).toBe(true);
      expect(envResult.exitCode).toBe(realResult.exitCode);
    });

    it("should change to parent directory with ..", async () => {
      const env = await setupFiles(testDir, {
        "parent/child/file.txt": "content",
      });

      // All commands in same exec (each exec is isolated like a new shell)
      const envResult = await env.exec("cd parent/child && cd .. && pwd");

      const realResult = await runRealBash(
        "cd parent/child && cd .. && pwd",
        testDir,
      );

      // Both should end with /parent
      expect(envResult.stdout.trim().endsWith("/parent")).toBe(true);
      expect(realResult.stdout.trim().endsWith("/parent")).toBe(true);
    });

    it("should handle multiple .. in path", async () => {
      const env = await setupFiles(testDir, {
        "a/b/c/file.txt": "content",
      });

      // All commands in same exec (each exec is isolated like a new shell)
      const envResult = await env.exec("cd a/b/c && cd ../.. && pwd");

      const realResult = await runRealBash(
        "cd a/b/c && cd ../.. && pwd",
        testDir,
      );

      // Both should end with /a
      expect(envResult.stdout.trim().endsWith("/a")).toBe(true);
      expect(realResult.stdout.trim().endsWith("/a")).toBe(true);
    });
  });

  describe("cd -", () => {
    it("should return to previous directory", async () => {
      const env = await setupFiles(testDir, {
        "dir1/file.txt": "",
        "dir2/file.txt": "",
      });

      // All commands in same exec (each exec is isolated like a new shell)
      const envResult = await env.exec("cd dir1 && cd ../dir2 && cd - && pwd");

      const realResult = await runRealBash(
        "cd dir1 && cd ../dir2 && cd - && pwd",
        testDir,
      );

      // Both should end with /dir1
      expect(envResult.stdout.trim().endsWith("/dir1")).toBe(true);
      expect(realResult.stdout.trim().endsWith("/dir1")).toBe(true);
    });
  });

  describe("cd errors", () => {
    it("should error on non-existent directory", async () => {
      const env = await setupFiles(testDir, {});

      const envResult = await env.exec("cd nonexistent");
      const realResult = await runRealBash(
        "cd nonexistent 2>&1; echo $?",
        testDir,
      );

      // Both should fail with exit code 1
      expect(envResult.exitCode).toBe(1);
      expect(realResult.stdout.trim().endsWith("1")).toBe(true);
    });

    it("should error when cd to file", async () => {
      const env = await setupFiles(testDir, {
        "file.txt": "content",
      });

      const envResult = await env.exec("cd file.txt");
      const realResult = await runRealBash(
        "cd file.txt 2>&1; echo $?",
        testDir,
      );

      // Both should fail
      expect(envResult.exitCode).toBe(1);
      expect(realResult.stdout.trim().endsWith("1")).toBe(true);
    });
  });

  describe("relative paths", () => {
    it("should handle relative path with .", async () => {
      const env = await setupFiles(testDir, {
        "subdir/file.txt": "",
      });

      const envResult = await env.exec("cd ./subdir && pwd");
      const realResult = await runRealBash("cd ./subdir && pwd", testDir);

      expect(envResult.stdout.trim().endsWith("/subdir")).toBe(true);
      expect(realResult.stdout.trim().endsWith("/subdir")).toBe(true);
    });

    it("should stay in same directory with cd .", async () => {
      const env = await setupFiles(testDir, {
        "file.txt": "",
      });

      // All commands in same exec (each exec is isolated like a new shell)
      const envResult = await env.exec("pwd; cd .; pwd");
      const lines = envResult.stdout.trim().split("\n");

      expect(lines[0]).toBe(lines[1]);
    });
  });
});
