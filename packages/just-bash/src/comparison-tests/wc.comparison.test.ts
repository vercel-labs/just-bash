import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

describe("wc command - Real Bash Comparison", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  // Note: normalizeWhitespace is needed because BSD (macOS) and GNU (Linux) wc
  // have different column width formatting, but the actual values are the same
  const wcOptions = { normalizeWhitespace: true };

  describe("default output (lines, words, chars)", () => {
    it("should match full wc output", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "line 1\nline 2\nline 3\n",
      });
      await compareOutputs(env, testDir, "wc test.txt", wcOptions);
    });

    it("should handle file without trailing newline", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "no newline",
      });
      await compareOutputs(env, testDir, "wc test.txt", wcOptions);
    });

    it("should handle empty file", async () => {
      const env = await setupFiles(testDir, {
        "empty.txt": "",
      });
      await compareOutputs(env, testDir, "wc empty.txt", wcOptions);
    });
  });

  describe("-l flag (line count)", () => {
    it("should match wc -l output", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "line 1\nline 2\nline 3\n",
      });
      await compareOutputs(env, testDir, "wc -l test.txt", wcOptions);
    });

    it("should count lines from stdin", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(
        env,
        testDir,
        'echo -e "a\\nb\\nc" | wc -l',
        wcOptions,
      );
    });
  });

  describe("-w flag (word count)", () => {
    it("should match wc -w output", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "one two three\nfour five\n",
      });
      await compareOutputs(env, testDir, "wc -w test.txt", wcOptions);
    });

    it("should count words with multiple spaces", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "one    two   three\n",
      });
      await compareOutputs(env, testDir, "wc -w test.txt", wcOptions);
    });
  });

  describe("-c flag (character/byte count)", () => {
    it("should match wc -c output", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "hello world\n",
      });
      await compareOutputs(env, testDir, "wc -c test.txt", wcOptions);
    });
  });

  describe("multiple files", () => {
    it("should show total for multiple files", async () => {
      const env = await setupFiles(testDir, {
        "a.txt": "file a\n",
        "b.txt": "file b line 1\nfile b line 2\n",
      });
      await compareOutputs(env, testDir, "wc a.txt b.txt", wcOptions);
    });

    it("should show -l for multiple files", async () => {
      const env = await setupFiles(testDir, {
        "a.txt": "line 1\nline 2\n",
        "b.txt": "line 1\nline 2\nline 3\n",
      });
      await compareOutputs(env, testDir, "wc -l a.txt b.txt", wcOptions);
    });
  });

  describe("combined flags", () => {
    it("should match -lw output", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "one two three\nfour five\n",
      });
      await compareOutputs(env, testDir, "wc -lw test.txt", wcOptions);
    });

    it("should match -wc output", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "hello world\n",
      });
      await compareOutputs(env, testDir, "wc -wc test.txt", wcOptions);
    });
  });

  describe("stdin", () => {
    it("should count stdin input", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(env, testDir, 'echo "hello world" | wc', wcOptions);
    });

    it("should count -l from stdin", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(
        env,
        testDir,
        'echo -e "a\\nb\\nc" | wc -l',
        wcOptions,
      );
    });
  });
});
