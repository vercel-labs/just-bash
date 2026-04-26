import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

describe("find command - Real Bash Comparison", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  describe("-name option", () => {
    it("should match with -name glob", async () => {
      const env = await setupFiles(testDir, {
        "file1.txt": "",
        "file2.js": "",
        "subdir/file3.txt": "",
      });
      await compareOutputs(env, testDir, 'find . -name "*.txt" | sort');
    });

    it("should match exact name", async () => {
      const env = await setupFiles(testDir, {
        "target.txt": "",
        "other.txt": "",
        "dir/target.txt": "",
      });
      await compareOutputs(env, testDir, 'find . -name "target.txt" | sort');
    });

    it("should match with ? wildcard", async () => {
      const env = await setupFiles(testDir, {
        "a1.txt": "",
        "a2.txt": "",
        "a10.txt": "",
        "b1.txt": "",
      });
      await compareOutputs(env, testDir, 'find . -name "a?.txt" | sort');
    });
  });

  describe("-type option", () => {
    it("should match -type f (files only)", async () => {
      const env = await setupFiles(testDir, {
        "file1.txt": "",
        "subdir/file2.txt": "",
      });
      await compareOutputs(env, testDir, "find . -type f | sort");
    });

    it("should match -type d (directories only)", async () => {
      const env = await setupFiles(testDir, {
        "dir1/file.txt": "",
        "dir2/file.txt": "",
      });
      await compareOutputs(env, testDir, "find . -type d | sort");
    });
  });

  describe("combining options", () => {
    it("should combine -name and -type", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "",
        "test.js": "",
        "sub/test.txt": "",
      });
      await compareOutputs(env, testDir, 'find . -name "*.txt" -type f | sort');
    });

    it("should use -o for OR logic", async () => {
      const env = await setupFiles(testDir, {
        "file.txt": "",
        "file.js": "",
        "file.md": "",
      });
      await compareOutputs(
        env,
        testDir,
        'find . -name "*.txt" -o -name "*.js" | sort',
      );
    });
  });

  describe("path handling", () => {
    it("should find from current directory with .", async () => {
      const env = await setupFiles(testDir, {
        "file.txt": "",
        "dir/file.txt": "",
      });
      await compareOutputs(env, testDir, 'find . -name "*.txt" | sort');
    });

    it("should find from specific directory", async () => {
      const env = await setupFiles(testDir, {
        "dir/a.txt": "",
        "dir/b.txt": "",
        "other/c.txt": "",
      });
      await compareOutputs(env, testDir, 'find dir -name "*.txt" | sort');
    });

    it("should include the starting directory when it matches", async () => {
      const env = await setupFiles(testDir, {
        "dir/file.txt": "",
      });
      await compareOutputs(env, testDir, "find . -type d | sort");
    });
  });

  describe("edge cases", () => {
    it("should handle deeply nested directories", async () => {
      const env = await setupFiles(testDir, {
        "a/b/c/d/file.txt": "",
      });
      await compareOutputs(env, testDir, 'find . -name "file.txt" | sort');
    });

    it("should handle hidden files", async () => {
      const env = await setupFiles(testDir, {
        ".hidden": "",
        "visible.txt": "",
        "dir/.also-hidden": "",
      });
      await compareOutputs(env, testDir, 'find . -name ".*" | sort');
    });
  });

  describe("-maxdepth option", () => {
    it("should limit to depth 0 (starting point only)", async () => {
      const env = await setupFiles(testDir, {
        "file.txt": "",
        "dir/file.txt": "",
      });
      await compareOutputs(env, testDir, "find . -maxdepth 0 | sort");
    });

    it("should limit to depth 1 (immediate children)", async () => {
      const env = await setupFiles(testDir, {
        "file.txt": "",
        "dir/file.txt": "",
        "dir/sub/file.txt": "",
      });
      await compareOutputs(env, testDir, "find . -maxdepth 1 | sort");
    });

    it("should limit to depth 2", async () => {
      const env = await setupFiles(testDir, {
        "a.txt": "",
        "dir/b.txt": "",
        "dir/sub/c.txt": "",
        "dir/sub/deep/d.txt": "",
      });
      await compareOutputs(env, testDir, "find . -maxdepth 2 | sort");
    });

    it("should combine -maxdepth with -name", async () => {
      const env = await setupFiles(testDir, {
        "a.txt": "",
        "dir/b.txt": "",
        "dir/sub/c.txt": "",
      });
      await compareOutputs(
        env,
        testDir,
        'find . -maxdepth 2 -name "*.txt" | sort',
      );
    });

    it("should combine -maxdepth with -type", async () => {
      const env = await setupFiles(testDir, {
        "file.txt": "",
        "dir/file.txt": "",
        "dir/sub/file.txt": "",
      });
      await compareOutputs(env, testDir, "find . -maxdepth 1 -type f | sort");
    });
  });

  describe("-mindepth option", () => {
    it("should skip depth 0", async () => {
      const env = await setupFiles(testDir, {
        "file.txt": "",
        "dir/file.txt": "",
      });
      await compareOutputs(env, testDir, "find . -mindepth 1 | sort");
    });

    it("should skip depths 0 and 1", async () => {
      const env = await setupFiles(testDir, {
        "a.txt": "",
        "dir/b.txt": "",
        "dir/sub/c.txt": "",
      });
      await compareOutputs(env, testDir, "find . -mindepth 2 | sort");
    });

    it("should combine -mindepth with -type d", async () => {
      const env = await setupFiles(testDir, {
        "dir/sub/file.txt": "",
      });
      await compareOutputs(env, testDir, "find . -mindepth 1 -type d | sort");
    });
  });

  describe("combined -maxdepth and -mindepth", () => {
    it("should find only at specific depth range", async () => {
      const env = await setupFiles(testDir, {
        "a.txt": "",
        "dir/b.txt": "",
        "dir/sub/c.txt": "",
        "dir/sub/deep/d.txt": "",
      });
      await compareOutputs(
        env,
        testDir,
        "find . -mindepth 1 -maxdepth 2 | sort",
      );
    });

    it("should find files only at depth 1", async () => {
      const env = await setupFiles(testDir, {
        "a.txt": "",
        "dir/b.txt": "",
        "dir/sub/c.txt": "",
      });
      await compareOutputs(
        env,
        testDir,
        "find . -mindepth 1 -maxdepth 1 -type f | sort",
      );
    });
  });
});
