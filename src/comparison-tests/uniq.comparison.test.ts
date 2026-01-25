import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

describe("uniq command - Real Bash Comparison", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  describe("default behavior", () => {
    it("should remove adjacent duplicates", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "apple\napple\nbanana\nbanana\nbanana\ncherry\n",
      });
      await compareOutputs(env, testDir, "uniq test.txt");
    });

    it("should only remove adjacent duplicates", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "apple\nbanana\napple\ncherry\nbanana\n",
      });
      await compareOutputs(env, testDir, "uniq test.txt");
    });

    it("should handle no duplicates", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "apple\nbanana\ncherry\n",
      });
      await compareOutputs(env, testDir, "uniq test.txt");
    });

    it("should handle all same lines", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "same\nsame\nsame\n",
      });
      await compareOutputs(env, testDir, "uniq test.txt");
    });
  });

  // Note: normalizeWhitespace is needed for -c tests because BSD and GNU uniq
  // have different column width formatting, but the actual values are the same
  const uniqCountOptions = { normalizeWhitespace: true };

  describe("-c flag (count)", () => {
    it("should count occurrences", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "apple\napple\nbanana\nbanana\nbanana\ncherry\n",
      });
      await compareOutputs(env, testDir, "uniq -c test.txt", uniqCountOptions);
    });

    it("should count single occurrences", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "a\nb\nc\n",
      });
      await compareOutputs(env, testDir, "uniq -c test.txt", uniqCountOptions);
    });
  });

  describe("-d flag (duplicates only)", () => {
    it("should show only duplicated lines", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "apple\napple\nbanana\ncherry\ncherry\n",
      });
      await compareOutputs(env, testDir, "uniq -d test.txt");
    });

    it("should handle no duplicates", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "a\nb\nc\n",
      });
      await compareOutputs(env, testDir, "uniq -d test.txt");
    });
  });

  describe("-u flag (unique only)", () => {
    it("should show only unique lines", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "apple\napple\nbanana\ncherry\ncherry\n",
      });
      await compareOutputs(env, testDir, "uniq -u test.txt");
    });

    it("should handle all unique", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "a\nb\nc\n",
      });
      await compareOutputs(env, testDir, "uniq -u test.txt");
    });

    it("should handle all duplicates", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "a\na\nb\nb\n",
      });
      await compareOutputs(env, testDir, "uniq -u test.txt");
    });
  });

  describe("combined with sort", () => {
    it("should work with sort for true unique", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "apple\nbanana\napple\ncherry\nbanana\n",
      });
      await compareOutputs(env, testDir, "sort test.txt | uniq");
    });

    it("should count after sort", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "apple\nbanana\napple\ncherry\nbanana\napple\n",
      });
      await compareOutputs(
        env,
        testDir,
        "sort test.txt | uniq -c",
        uniqCountOptions,
      );
    });
  });

  describe("stdin", () => {
    it("should read from stdin", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(env, testDir, 'echo -e "a\\na\\nb" | uniq');
    });

    it("should count from stdin", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(
        env,
        testDir,
        'echo -e "a\\na\\nb\\nb\\nb" | uniq -c',
        uniqCountOptions,
      );
    });
  });

  describe("combined flags", () => {
    it("should combine -c and -d", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "a\na\nb\nc\nc\nc\n",
      });
      await compareOutputs(env, testDir, "uniq -cd test.txt", uniqCountOptions);
    });
  });
});
