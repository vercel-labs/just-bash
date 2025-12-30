import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./test-helpers.js";

describe("ls command - Real Bash Comparison", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  describe("basic listing", () => {
    it("should match directory listing", async () => {
      const env = await setupFiles(testDir, {
        "file1.txt": "content",
        "file2.txt": "content",
        "subdir/file3.txt": "content",
      });
      await compareOutputs(env, testDir, "ls");
    });

    it("should match -1 output (one per line)", async () => {
      const env = await setupFiles(testDir, {
        "aaa.txt": "",
        "bbb.txt": "",
        "ccc.txt": "",
      });
      await compareOutputs(env, testDir, "ls -1");
    });

    it("should match with specific path", async () => {
      const env = await setupFiles(testDir, {
        "subdir/file1.txt": "",
        "subdir/file2.txt": "",
      });
      await compareOutputs(env, testDir, "ls subdir");
    });

    it("should match empty directory", async () => {
      const env = await setupFiles(testDir, {
        "subdir/.gitkeep": "",
      });
      // Note: empty dirs won't exist in virtual fs without files
      await compareOutputs(env, testDir, "ls subdir");
    });
  });

  describe("flags", () => {
    it("should match -a (show hidden)", async () => {
      const env = await setupFiles(testDir, {
        ".hidden": "",
        "visible.txt": "",
      });
      await compareOutputs(env, testDir, "ls -a");
    });

    it("should match -A (show hidden except . and ..)", async () => {
      const env = await setupFiles(testDir, {
        ".hidden": "",
        "visible.txt": "",
      });
      await compareOutputs(env, testDir, "ls -A");
    });

    // Uses recorded fixture with Linux behavior (includes ".:" header)
    it("should match -R (recursive)", async () => {
      const env = await setupFiles(testDir, {
        "file.txt": "",
        "dir/file1.txt": "",
        "dir/sub/file2.txt": "",
      });
      await compareOutputs(env, testDir, "ls -R");
    });

    it("should match -r (reverse)", async () => {
      const env = await setupFiles(testDir, {
        "aaa.txt": "",
        "bbb.txt": "",
        "ccc.txt": "",
      });
      await compareOutputs(env, testDir, "ls -1r");
    });
  });

  describe("sorting", () => {
    it("should sort alphabetically by default", async () => {
      const env = await setupFiles(testDir, {
        "zebra.txt": "",
        "apple.txt": "",
        "banana.txt": "",
      });
      await compareOutputs(env, testDir, "ls -1");
    });

    it("should sort case-insensitively", async () => {
      const env = await setupFiles(testDir, {
        "Apple.txt": "",
        "banana.txt": "",
        "cherry.txt": "",
      });
      await compareOutputs(env, testDir, "ls -1");
    });
  });

  describe("multiple paths", () => {
    it("should list multiple directories", async () => {
      const env = await setupFiles(testDir, {
        "dir1/a.txt": "",
        "dir2/b.txt": "",
      });
      await compareOutputs(env, testDir, "ls dir1 dir2");
    });

    it("should handle files and directories mixed", async () => {
      const env = await setupFiles(testDir, {
        "file.txt": "",
        "dir/nested.txt": "",
      });
      await compareOutputs(env, testDir, "ls file.txt dir");
    });
  });
});
