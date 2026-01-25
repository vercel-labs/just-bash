import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

describe("grep command - Real Bash Comparison", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  describe("basic matching", () => {
    it("should match basic search", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "hello world\nfoo bar\nhello again\n",
      });
      await compareOutputs(env, testDir, "grep hello test.txt");
    });

    it("should match with no results", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "hello world\n",
      });
      await compareOutputs(env, testDir, "grep notfound test.txt || true");
    });

    it("should match pattern at start of line", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "hello world\nworld hello\n",
      });
      await compareOutputs(env, testDir, 'grep "^hello" test.txt');
    });

    it("should match pattern at end of line", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "hello world\nworld hello\n",
      });
      await compareOutputs(env, testDir, 'grep "world$" test.txt');
    });
  });

  describe("flags", () => {
    it("should match -n (line numbers)", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "hello world\nfoo bar\nhello again\n",
      });
      await compareOutputs(env, testDir, "grep -n hello test.txt");
    });

    it("should match -i (case insensitive)", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "Hello World\nHELLO AGAIN\nhello there\n",
      });
      await compareOutputs(env, testDir, "grep -i hello test.txt");
    });

    it("should match -c (count)", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "hello world\nfoo bar\nhello again\n",
      });
      await compareOutputs(env, testDir, "grep -c hello test.txt");
    });

    it("should match -v (invert)", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "hello world\nfoo bar\nhello again\n",
      });
      await compareOutputs(env, testDir, "grep -v hello test.txt");
    });

    it("should match -l (files with matches)", async () => {
      const env = await setupFiles(testDir, {
        "a.txt": "hello world\n",
        "b.txt": "no match\n",
        "c.txt": "hello there\n",
      });
      await compareOutputs(env, testDir, "grep -l hello a.txt b.txt c.txt");
    });

    it("should match -o (only matching)", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "hello world hello\nfoo hello bar\n",
      });
      await compareOutputs(env, testDir, "grep -o hello test.txt");
    });

    it("should match -w (word match)", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "hello world\nhelloworld\nworld hello\n",
      });
      await compareOutputs(env, testDir, "grep -w hello test.txt");
    });

    it("should match -h (no filename)", async () => {
      const env = await setupFiles(testDir, {
        "a.txt": "hello a\n",
        "b.txt": "hello b\n",
      });
      await compareOutputs(env, testDir, "grep -h hello a.txt b.txt");
    });
  });

  describe("recursive", () => {
    it("should match -r (recursive)", async () => {
      const env = await setupFiles(testDir, {
        "dir/file1.txt": "hello from file1\n",
        "dir/file2.txt": "goodbye from file2\n",
        "dir/sub/file3.txt": "hello from file3\n",
      });
      await compareOutputs(env, testDir, "grep -r hello dir");
    });

    it("should match -rl (recursive files only)", async () => {
      const env = await setupFiles(testDir, {
        "dir/a.txt": "hello\n",
        "dir/b.txt": "world\n",
        "dir/sub/c.txt": "hello\n",
      });
      await compareOutputs(env, testDir, "grep -rl hello dir | sort");
    });

    it("should match --include pattern", async () => {
      const env = await setupFiles(testDir, {
        "dir/test.ts": "hello ts\n",
        "dir/test.js": "hello js\n",
        "dir/test.txt": "hello txt\n",
      });
      await compareOutputs(env, testDir, 'grep -r --include="*.ts" hello dir');
    });
  });

  describe("context", () => {
    it("should match -A (after context)", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "line1\nmatch\nline3\nline4\n",
      });
      await compareOutputs(env, testDir, "grep -A 2 match test.txt");
    });

    it("should match -B (before context)", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "line1\nline2\nmatch\nline4\n",
      });
      await compareOutputs(env, testDir, "grep -B 2 match test.txt");
    });

    it("should match -C (context)", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "line1\nline2\nmatch\nline4\nline5\n",
      });
      await compareOutputs(env, testDir, "grep -C 1 match test.txt");
    });
  });

  describe("multiple files", () => {
    it("should show filename prefix for multiple files", async () => {
      const env = await setupFiles(testDir, {
        "a.txt": "hello a\n",
        "b.txt": "hello b\n",
      });
      await compareOutputs(env, testDir, "grep hello a.txt b.txt");
    });

    it("should match -c with multiple files", async () => {
      const env = await setupFiles(testDir, {
        "a.txt": "hello\nhello\n",
        "b.txt": "hello\n",
        "c.txt": "world\n",
      });
      await compareOutputs(env, testDir, "grep -c hello a.txt b.txt c.txt");
    });
  });

  describe("regex patterns", () => {
    it("should match character class", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "cat\nhat\nbat\nrat\n",
      });
      await compareOutputs(env, testDir, 'grep "[ch]at" test.txt');
    });

    it("should match dot wildcard", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "cat\ncut\ncot\ncart\n",
      });
      await compareOutputs(env, testDir, 'grep "c.t" test.txt');
    });

    it("should match star quantifier", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "ct\ncat\ncaat\ncaaat\n",
      });
      await compareOutputs(env, testDir, 'grep "ca*t" test.txt');
    });

    it("should match plus quantifier with -E", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "ct\ncat\ncaat\ncaaat\n",
      });
      await compareOutputs(env, testDir, 'grep -E "ca+t" test.txt');
    });
  });

  describe("-F (fixed strings)", () => {
    it("should match literal string with special chars", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "hello.*world\ntest pattern\nhello.world\n",
      });
      await compareOutputs(env, testDir, 'grep -F ".*" test.txt');
    });

    it("should match literal dot", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "a.b\naXb\na..b\n",
      });
      await compareOutputs(env, testDir, 'grep -F "." test.txt');
    });

    it("should match literal brackets", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "[test]\ntest\n[another]\n",
      });
      await compareOutputs(env, testDir, 'grep -F "[test]" test.txt');
    });

    it("should combine -F with -i", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "Hello.World\nhello.world\nHELLO.WORLD\n",
      });
      await compareOutputs(env, testDir, 'grep -Fi "hello.world" test.txt');
    });
  });

  describe("-q (quiet mode)", () => {
    it("should suppress output when match found", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "hello world\nfoo bar\n",
      });
      await compareOutputs(env, testDir, "grep -q hello test.txt");
    });

    it("should return exit code 0 on match", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "hello world\n",
      });
      await compareOutputs(
        env,
        testDir,
        "grep -q hello test.txt && echo found",
      );
    });

    it("should return exit code 1 on no match", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "hello world\n",
      });
      await compareOutputs(
        env,
        testDir,
        'grep -q notfound test.txt || echo "not found"',
      );
    });

    it("should work with pipe", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(
        env,
        testDir,
        'echo "hello world" | grep -q hello && echo matched',
      );
    });
  });
});
