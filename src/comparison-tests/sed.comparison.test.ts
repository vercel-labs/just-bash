import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

describe("sed command - Real Bash Comparison", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  describe("substitution (s command)", () => {
    it("should substitute first occurrence", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "hello world\nhello again\n",
      });
      await compareOutputs(env, testDir, "sed 's/hello/hi/' test.txt");
    });

    it("should substitute all occurrences with g flag", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "hello hello hello\n",
      });
      await compareOutputs(env, testDir, "sed 's/hello/hi/g' test.txt");
    });

    it("should handle case insensitive with i flag", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "Hello HELLO hello\n",
      });
      await compareOutputs(env, testDir, "sed 's/hello/hi/gi' test.txt");
    });

    it("should substitute with empty string", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "hello world\n",
      });
      await compareOutputs(env, testDir, "sed 's/hello//' test.txt");
    });

    it("should handle special characters in pattern", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "hello.world\n",
      });
      await compareOutputs(env, testDir, "sed 's/\\./-/g' test.txt");
    });
  });

  describe("different delimiters", () => {
    it("should use / as delimiter", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "hello world\n",
      });
      await compareOutputs(env, testDir, "sed 's/hello/hi/' test.txt");
    });

    it("should use # as delimiter", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "path/to/file\n",
      });
      await compareOutputs(env, testDir, "sed 's#path/to#new/path#' test.txt");
    });

    it("should use | as delimiter", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "a/b/c\n",
      });
      await compareOutputs(env, testDir, "sed 's|/|-|g' test.txt");
    });
  });

  describe("address ranges", () => {
    it("should substitute only on line 1", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "hello\nhello\nhello\n",
      });
      await compareOutputs(env, testDir, "sed '1s/hello/hi/' test.txt");
    });

    it("should substitute on line 2", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "hello\nhello\nhello\n",
      });
      await compareOutputs(env, testDir, "sed '2s/hello/hi/' test.txt");
    });

    it("should substitute on last line", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "hello\nhello\nhello\n",
      });
      await compareOutputs(env, testDir, "sed '$ s/hello/hi/' test.txt");
    });

    it("should substitute on range of lines", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "hello\nhello\nhello\nhello\n",
      });
      await compareOutputs(env, testDir, "sed '2,3s/hello/hi/' test.txt");
    });
  });

  describe("delete command (d)", () => {
    it("should delete matching lines", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "keep\ndelete\nkeep\n",
      });
      await compareOutputs(env, testDir, "sed '/delete/d' test.txt");
    });

    it("should delete first line", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "line1\nline2\nline3\n",
      });
      await compareOutputs(env, testDir, "sed '1d' test.txt");
    });

    it("should delete last line", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "line1\nline2\nline3\n",
      });
      await compareOutputs(env, testDir, "sed '$ d' test.txt");
    });

    it("should delete range of lines", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "line1\nline2\nline3\nline4\n",
      });
      await compareOutputs(env, testDir, "sed '2,3d' test.txt");
    });
  });

  describe("stdin", () => {
    it("should read from stdin", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(
        env,
        testDir,
        "echo 'hello world' | sed 's/hello/hi/'",
      );
    });

    it("should handle multiline stdin", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(
        env,
        testDir,
        "echo -e 'hello\\nworld' | sed 's/o/0/g'",
      );
    });
  });

  describe("multiple expressions", () => {
    it("should apply multiple -e expressions", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "hello world\n",
      });
      await compareOutputs(
        env,
        testDir,
        "sed -e 's/hello/hi/' -e 's/world/there/' test.txt",
      );
    });
  });

  describe("edge cases", () => {
    it("should handle empty file", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "",
      });
      await compareOutputs(env, testDir, "sed 's/a/b/' test.txt");
    });

    it("should handle no matches", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "hello world\n",
      });
      await compareOutputs(env, testDir, "sed 's/xyz/abc/' test.txt");
    });

    it("should handle & in replacement", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "hello\n",
      });
      await compareOutputs(env, testDir, "sed 's/hello/[&]/' test.txt");
    });
  });
});
