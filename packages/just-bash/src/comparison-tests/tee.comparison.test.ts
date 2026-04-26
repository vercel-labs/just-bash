import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanupTestDir,
  createTestDir,
  fs,
  path,
  runRealBash,
  setupFiles,
} from "./fixture-runner.js";

describe("tee command - Real Bash Comparison", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  describe("basic usage", () => {
    it("should pass through stdin to stdout", async () => {
      const env = await setupFiles(testDir, {});

      const envResult = await env.exec("echo hello | tee");
      const realResult = await runRealBash("echo hello | tee", testDir);

      expect(envResult.stdout).toBe(realResult.stdout);
      expect(envResult.exitCode).toBe(realResult.exitCode);
    });

    it("should write to file and stdout", async () => {
      const env = await setupFiles(testDir, {});

      const envResult = await env.exec("echo hello | tee output.txt");
      const realResult = await runRealBash(
        "echo hello | tee output.txt",
        testDir,
      );

      expect(envResult.stdout).toBe(realResult.stdout);

      // Compare file contents
      const envContent = await env.readFile("output.txt");
      const realContent = await fs.readFile(
        path.join(testDir, "output.txt"),
        "utf-8",
      );
      expect(envContent).toBe(realContent);
    });

    it("should write to multiple files", async () => {
      const env = await setupFiles(testDir, {});

      const envResult = await env.exec("echo hello | tee file1.txt file2.txt");
      const realResult = await runRealBash(
        "echo hello | tee file1.txt file2.txt",
        testDir,
      );

      expect(envResult.stdout).toBe(realResult.stdout);

      // Compare file contents
      const envContent1 = await env.readFile("file1.txt");
      const realContent1 = await fs.readFile(
        path.join(testDir, "file1.txt"),
        "utf-8",
      );
      expect(envContent1).toBe(realContent1);

      const envContent2 = await env.readFile("file2.txt");
      const realContent2 = await fs.readFile(
        path.join(testDir, "file2.txt"),
        "utf-8",
      );
      expect(envContent2).toBe(realContent2);
    });
  });

  describe("append mode", () => {
    it("should append with -a flag", async () => {
      const env = await setupFiles(testDir, {
        "existing.txt": "existing content\n",
      });
      await fs.writeFile(
        path.join(testDir, "existing.txt"),
        "existing content\n",
      );

      await env.exec("echo appended | tee -a existing.txt");
      await runRealBash("echo appended | tee -a existing.txt", testDir);

      const envContent = await env.readFile("existing.txt");
      const realContent = await fs.readFile(
        path.join(testDir, "existing.txt"),
        "utf-8",
      );
      expect(envContent).toBe(realContent);
    });
  });

  describe("multiline content", () => {
    it("should handle multiline input", async () => {
      const env = await setupFiles(testDir, {});

      const envResult = await env.exec(
        'echo -e "line1\\nline2\\nline3" | tee output.txt',
      );
      const realResult = await runRealBash(
        'echo -e "line1\\nline2\\nline3" | tee output.txt',
        testDir,
      );

      expect(envResult.stdout).toBe(realResult.stdout);

      const envContent = await env.readFile("output.txt");
      const realContent = await fs.readFile(
        path.join(testDir, "output.txt"),
        "utf-8",
      );
      expect(envContent).toBe(realContent);
    });
  });
});
