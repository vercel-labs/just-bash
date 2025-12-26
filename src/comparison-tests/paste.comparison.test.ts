import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./test-helpers.js";

describe("paste command - Real Bash Comparison", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  describe("basic functionality", () => {
    it("should paste two files with default tab delimiter", async () => {
      const env = await setupFiles(testDir, {
        "file1.txt": "a\nb\nc\n",
        "file2.txt": "1\n2\n3\n",
      });
      await compareOutputs(env, testDir, "paste file1.txt file2.txt");
    });

    it("should paste three files", async () => {
      const env = await setupFiles(testDir, {
        "file1.txt": "a\nb\nc\n",
        "file2.txt": "1\n2\n3\n",
        "file3.txt": "x\ny\nz\n",
      });
      await compareOutputs(env, testDir, "paste file1.txt file2.txt file3.txt");
    });

    it("should handle single file", async () => {
      const env = await setupFiles(testDir, {
        "file1.txt": "a\nb\nc\n",
      });
      await compareOutputs(env, testDir, "paste file1.txt");
    });

    it("should handle files with uneven line counts", async () => {
      const env = await setupFiles(testDir, {
        "short.txt": "a\nb\n",
        "long.txt": "1\n2\n3\n4\n",
      });
      await compareOutputs(env, testDir, "paste short.txt long.txt");
    });
  });

  describe("-d (delimiter)", () => {
    it("should use comma as delimiter", async () => {
      const env = await setupFiles(testDir, {
        "file1.txt": "a\nb\nc\n",
        "file2.txt": "1\n2\n3\n",
      });
      await compareOutputs(env, testDir, "paste -d, file1.txt file2.txt");
    });

    it("should use colon as delimiter", async () => {
      const env = await setupFiles(testDir, {
        "file1.txt": "a\nb\nc\n",
        "file2.txt": "1\n2\n3\n",
      });
      await compareOutputs(env, testDir, "paste -d: file1.txt file2.txt");
    });

    it("should use space as delimiter", async () => {
      const env = await setupFiles(testDir, {
        "file1.txt": "a\nb\nc\n",
        "file2.txt": "1\n2\n3\n",
      });
      await compareOutputs(env, testDir, 'paste -d" " file1.txt file2.txt');
    });

    it("should cycle through multiple delimiters", async () => {
      const env = await setupFiles(testDir, {
        "file1.txt": "a\nb\nc\n",
        "file2.txt": "1\n2\n3\n",
        "file3.txt": "x\ny\nz\n",
      });
      await compareOutputs(
        env,
        testDir,
        "paste -d,: file1.txt file2.txt file3.txt",
      );
    });
  });

  describe("-s (serial)", () => {
    it("should paste lines horizontally in serial mode", async () => {
      const env = await setupFiles(testDir, {
        "file1.txt": "a\nb\nc\n",
      });
      await compareOutputs(env, testDir, "paste -s file1.txt");
    });

    it("should paste multiple files serially", async () => {
      const env = await setupFiles(testDir, {
        "file1.txt": "a\nb\nc\n",
        "file2.txt": "1\n2\n3\n",
      });
      await compareOutputs(env, testDir, "paste -s file1.txt file2.txt");
    });

    it("should use custom delimiter in serial mode", async () => {
      const env = await setupFiles(testDir, {
        "file1.txt": "a\nb\nc\n",
      });
      await compareOutputs(env, testDir, "paste -s -d, file1.txt");
    });

    it("should handle combined -sd option", async () => {
      const env = await setupFiles(testDir, {
        "file1.txt": "a\nb\nc\n",
      });
      await compareOutputs(env, testDir, "paste -sd, file1.txt");
    });
  });

  describe("stdin", () => {
    it("should read from stdin with explicit -", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(env, testDir, 'echo -e "a\\nb\\nc" | paste -');
    });

    it("should paste stdin with file", async () => {
      const env = await setupFiles(testDir, {
        "file1.txt": "a\nb\nc\n",
      });
      await compareOutputs(
        env,
        testDir,
        'echo -e "1\\n2\\n3" | paste - file1.txt',
      );
    });

    it("should handle - - to paste pairs of lines", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(env, testDir, 'echo -e "a\\nb\\nc\\nd" | paste - -');
    });

    it("should handle - - - to paste triplets of lines", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(
        env,
        testDir,
        'echo -e "a\\nb\\nc\\nd\\ne\\nf" | paste - - -',
      );
    });
  });

  describe("edge cases", () => {
    it("should handle empty file", async () => {
      const env = await setupFiles(testDir, {
        "empty.txt": "",
        "file1.txt": "a\nb\nc\n",
      });
      await compareOutputs(env, testDir, "paste empty.txt file1.txt");
    });

    it("should handle file with single line", async () => {
      const env = await setupFiles(testDir, {
        "single.txt": "hello\n",
        "file1.txt": "a\nb\nc\n",
      });
      await compareOutputs(env, testDir, "paste single.txt file1.txt");
    });
  });
});
