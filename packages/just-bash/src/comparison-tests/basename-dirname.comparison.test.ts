import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

describe("basename command - Real Bash Comparison", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  describe("basic usage", () => {
    it("should extract basename from absolute path", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(env, testDir, "basename /usr/bin/sort");
    });

    it("should extract basename from relative path", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(env, testDir, "basename ./path/to/file.txt");
    });

    it("should handle filename without directory", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(env, testDir, "basename file.txt");
    });

    it("should handle path ending with slash", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(env, testDir, "basename /path/to/dir/");
    });
  });

  describe("suffix removal", () => {
    it("should remove suffix when specified", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(env, testDir, "basename /path/to/file.txt .txt");
    });

    it("should not remove suffix if not matching", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(env, testDir, "basename /path/to/file.txt .md");
    });

    it("should handle -s option", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(env, testDir, "basename -s .txt /path/to/file.txt");
    });
  });

  describe("multiple files with -a", () => {
    it("should handle multiple paths with -a", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(
        env,
        testDir,
        "basename -a /path/one.txt /path/two.txt",
      );
    });

    it("should handle -a with -s", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(
        env,
        testDir,
        "basename -a -s .txt /path/one.txt /path/two.txt",
      );
    });
  });
});

describe("dirname command - Real Bash Comparison", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  describe("basic usage", () => {
    it("should extract directory from absolute path", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(env, testDir, "dirname /usr/bin/sort");
    });

    it("should extract directory from relative path", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(env, testDir, "dirname ./path/to/file.txt");
    });

    it("should return . for filename without directory", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(env, testDir, "dirname file.txt");
    });

    it("should return / for root-level file", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(env, testDir, "dirname /file.txt");
    });

    it("should handle path with trailing slash", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(env, testDir, "dirname /path/to/dir/");
    });
  });

  describe("multiple paths", () => {
    it("should handle multiple paths", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(
        env,
        testDir,
        "dirname /path/to/file1 /another/path/file2",
      );
    });
  });
});
