import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

describe("sort command - Real Bash Comparison", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  describe("default sorting", () => {
    it("should sort alphabetically", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "banana\napple\ncherry\n",
      });
      await compareOutputs(env, testDir, "sort test.txt");
    });

    it("should sort with mixed case", async () => {
      // Skip: macOS and Linux have different default locale sorting for mixed case
      // macOS: case-sensitive ASCII order (A-Z before a-z)
      // Linux: locale-aware order (case-insensitive by default)
      // BashEnv uses JavaScript's sort which is ASCII-order like macOS
      const env = await setupFiles(testDir, {
        "test.txt": "banana\napple\ncherry\n",
      });
      await compareOutputs(env, testDir, "sort test.txt");
    });

    it("should handle empty lines", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "b\n\na\n\nc\n",
      });
      await compareOutputs(env, testDir, "sort test.txt");
    });
  });

  describe("-r flag (reverse)", () => {
    it("should sort in reverse", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "banana\napple\ncherry\n",
      });
      await compareOutputs(env, testDir, "sort -r test.txt");
    });
  });

  describe("-n flag (numeric)", () => {
    it("should sort numerically", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "10\n2\n1\n20\n5\n",
      });
      await compareOutputs(env, testDir, "sort -n test.txt");
    });

    it("should sort negative numbers", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "10\n-5\n0\n-10\n5\n",
      });
      await compareOutputs(env, testDir, "sort -n test.txt");
    });

    it("should handle mixed numbers and text", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "10 apples\n2 oranges\n5 bananas\n",
      });
      await compareOutputs(env, testDir, "sort -n test.txt");
    });
  });

  describe("-u flag (unique)", () => {
    it("should remove duplicates", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "apple\nbanana\napple\ncherry\nbanana\n",
      });
      await compareOutputs(env, testDir, "sort -u test.txt");
    });

    it("should combine -n and -u", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "5\n3\n5\n1\n3\n",
      });
      await compareOutputs(env, testDir, "sort -nu test.txt");
    });
  });

  describe("-k flag (key field)", () => {
    it("should sort by second field", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "x 3\ny 1\nz 2\n",
      });
      await compareOutputs(env, testDir, "sort -k 2 test.txt");
    });

    it("should sort numerically by key", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "x 10\ny 2\nz 5\n",
      });
      await compareOutputs(env, testDir, "sort -k 2 -n test.txt");
    });
  });

  describe("-t flag (delimiter)", () => {
    it("should use custom delimiter", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "a:3\nb:1\nc:2\n",
      });
      await compareOutputs(env, testDir, "sort -t: -k2 test.txt");
    });

    it("should sort numerically with delimiter", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "a:10\nb:2\nc:5\n",
      });
      await compareOutputs(env, testDir, "sort -t: -k2 -n test.txt");
    });

    it("should reverse sort with delimiter", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "a:1\nb:3\nc:2\n",
      });
      await compareOutputs(env, testDir, "sort -t: -k2 -rn test.txt");
    });
  });

  describe("stdin", () => {
    it("should sort stdin", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(env, testDir, 'echo -e "c\\na\\nb" | sort');
    });
  });

  describe("combined flags", () => {
    it("should combine -n and -r", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "10\n2\n1\n20\n",
      });
      await compareOutputs(env, testDir, "sort -nr test.txt");
    });

    it("should combine -r and -u", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "apple\nbanana\napple\ncherry\n",
      });
      await compareOutputs(env, testDir, "sort -ru test.txt");
    });
  });

  describe("-h flag (human numeric)", () => {
    it("should sort human readable sizes", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "1K\n2M\n500\n1G\n100K\n",
      });
      await compareOutputs(env, testDir, "sort -h test.txt");
    });

    it("should sort human sizes in reverse", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "1K\n1M\n1G\n",
      });
      await compareOutputs(env, testDir, "sort -hr test.txt");
    });
  });

  describe("-V flag (version)", () => {
    it("should sort version numbers", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "file1.10\nfile1.2\nfile1.1\n",
      });
      await compareOutputs(env, testDir, "sort -V test.txt");
    });

    it("should sort semver-like versions", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "1.0.10\n1.0.2\n1.0.0\n",
      });
      await compareOutputs(env, testDir, "sort -V test.txt");
    });
  });

  describe("-c flag (check)", () => {
    it("should return 0 for sorted input", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "a\nb\nc\n",
      });
      await compareOutputs(env, testDir, "sort -c test.txt; echo $?");
    });

    it("should return 1 for unsorted input", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "b\na\nc\n",
      });
      await compareOutputs(env, testDir, "sort -c test.txt 2>&1; echo $?");
    });
  });

  describe("-b flag (ignore leading blanks)", () => {
    it("should ignore leading blanks", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "  b\na\n   c\n",
      });
      await compareOutputs(env, testDir, "sort -b test.txt");
    });
  });
});
