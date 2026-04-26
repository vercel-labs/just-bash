import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  fs,
  path,
  runRealBash,
  setupFiles,
} from "./fixture-runner.js";

describe("Pipes - Real Bash Comparison", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  describe("simple pipes", () => {
    it("should pipe echo to cat", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(env, testDir, 'echo "hello" | cat');
    });

    it("should pipe cat to sort", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "cherry\napple\nbanana\n",
      });
      await compareOutputs(env, testDir, "cat test.txt | sort");
    });

    it("should pipe cat to grep", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "hello world\nfoo bar\nhello again\n",
      });
      await compareOutputs(env, testDir, "cat test.txt | grep hello");
    });

    it("should pipe grep to wc", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "hello\nworld\nhello\n",
      });
      // normalizeWhitespace needed because BSD/GNU wc have different column widths
      await compareOutputs(env, testDir, "grep hello test.txt | wc -l", {
        normalizeWhitespace: true,
      });
    });
  });

  describe("multiple pipes", () => {
    it("should chain three commands", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "cherry\napple\nbanana\napple\n",
      });
      await compareOutputs(env, testDir, "cat test.txt | sort | uniq");
    });

    it("should chain four commands", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "hello world\nfoo bar\nhello again\nbaz qux\n",
      });
      // normalizeWhitespace needed because BSD/GNU wc have different column widths
      await compareOutputs(
        env,
        testDir,
        "cat test.txt | grep hello | sort | wc -l",
        { normalizeWhitespace: true },
      );
    });

    it("should pipe through tr and sort", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "CHERRY\napple\nBANANA\n",
      });
      await compareOutputs(
        env,
        testDir,
        "cat test.txt | tr 'A-Z' 'a-z' | sort",
      );
    });

    it("should pipe through cut and sort", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "b:2\na:3\nc:1\n",
      });
      await compareOutputs(
        env,
        testDir,
        "cat test.txt | cut -d: -f2 | sort -n",
      );
    });
  });

  describe("pipes with head and tail", () => {
    it("should pipe to head", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "line1\nline2\nline3\nline4\nline5\n",
      });
      await compareOutputs(env, testDir, "cat test.txt | head -n 3");
    });

    it("should pipe to tail", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "line1\nline2\nline3\nline4\nline5\n",
      });
      await compareOutputs(env, testDir, "cat test.txt | tail -n 2");
    });

    it("should pipe head to tail", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "line1\nline2\nline3\nline4\nline5\n",
      });
      await compareOutputs(
        env,
        testDir,
        "cat test.txt | head -n 4 | tail -n 2",
      );
    });
  });
});

describe("Output Redirections - Real Bash Comparison", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  describe("stdout redirection (>)", () => {
    it("should redirect echo to file", async () => {
      const env = await setupFiles(testDir, {});

      await env.exec('echo "hello world" > output.txt');
      await runRealBash('echo "hello world" > output.txt', testDir);

      const bashEnvContent = await env.readFile(
        path.join(testDir, "output.txt"),
      );
      const realContent = await fs.readFile(
        path.join(testDir, "output.txt"),
        "utf-8",
      );
      expect(bashEnvContent).toBe(realContent);
    });

    it("should overwrite existing file", async () => {
      const env = await setupFiles(testDir, {
        "output.txt": "old content\n",
      });

      await env.exec('echo "new content" > output.txt');
      await runRealBash('echo "new content" > output.txt', testDir);

      const bashEnvContent = await env.readFile(
        path.join(testDir, "output.txt"),
      );
      const realContent = await fs.readFile(
        path.join(testDir, "output.txt"),
        "utf-8",
      );
      expect(bashEnvContent).toBe(realContent);
    });

    it("should redirect grep output", async () => {
      const env = await setupFiles(testDir, {
        "input.txt": "hello\nworld\nhello again\n",
      });

      await env.exec("grep hello input.txt > output.txt");
      await runRealBash("grep hello input.txt > output.txt", testDir);

      const bashEnvContent = await env.readFile(
        path.join(testDir, "output.txt"),
      );
      const realContent = await fs.readFile(
        path.join(testDir, "output.txt"),
        "utf-8",
      );
      expect(bashEnvContent).toBe(realContent);
    });
  });

  describe("append redirection (>>)", () => {
    it("should append to file", async () => {
      const env = await setupFiles(testDir, {
        "output.txt": "line 1\n",
      });

      await env.exec('echo "line 2" >> output.txt');
      await runRealBash('echo "line 2" >> output.txt', testDir);

      const bashEnvContent = await env.readFile(
        path.join(testDir, "output.txt"),
      );
      const realContent = await fs.readFile(
        path.join(testDir, "output.txt"),
        "utf-8",
      );
      expect(bashEnvContent).toBe(realContent);
    });

    it("should create file if not exists", async () => {
      const env = await setupFiles(testDir, {});

      await env.exec('echo "new line" >> output.txt');
      await runRealBash('echo "new line" >> output.txt', testDir);

      const bashEnvContent = await env.readFile(
        path.join(testDir, "output.txt"),
      );
      const realContent = await fs.readFile(
        path.join(testDir, "output.txt"),
        "utf-8",
      );
      expect(bashEnvContent).toBe(realContent);
    });

    it("should append multiple times", async () => {
      const env = await setupFiles(testDir, {});

      await env.exec('echo "line 1" >> output.txt');
      await env.exec('echo "line 2" >> output.txt');
      await runRealBash(
        'echo "line 1" >> output.txt && echo "line 2" >> output.txt',
        testDir,
      );

      const bashEnvContent = await env.readFile(
        path.join(testDir, "output.txt"),
      );
      const realContent = await fs.readFile(
        path.join(testDir, "output.txt"),
        "utf-8",
      );
      expect(bashEnvContent).toBe(realContent);
    });
  });

  describe("pipes with redirections", () => {
    it("should pipe and redirect", async () => {
      const env = await setupFiles(testDir, {
        "input.txt": "cherry\napple\nbanana\n",
      });

      await env.exec("cat input.txt | sort > output.txt");
      await runRealBash("cat input.txt | sort > output.txt", testDir);

      const bashEnvContent = await env.readFile(
        path.join(testDir, "output.txt"),
      );
      const realContent = await fs.readFile(
        path.join(testDir, "output.txt"),
        "utf-8",
      );
      expect(bashEnvContent).toBe(realContent);
    });
  });
});

describe("Command Chaining - Real Bash Comparison", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  describe("&& (AND) chaining", () => {
    it("should execute second command if first succeeds", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "hello\n",
      });
      await compareOutputs(
        env,
        testDir,
        "echo start && cat test.txt && echo end",
      );
    });

    it("should stop on failure", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(
        env,
        testDir,
        'cat nonexistent.txt 2>/dev/null && echo "never shown"',
      );
    });
  });

  describe("|| (OR) chaining", () => {
    it("should execute second command if first fails", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(
        env,
        testDir,
        'cat nonexistent.txt 2>/dev/null || echo "file not found"',
      );
    });

    it("should skip second command if first succeeds", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(
        env,
        testDir,
        'echo "success" || echo "never shown"',
      );
    });
  });

  describe("; (sequential) chaining", () => {
    it("should execute all commands regardless of exit code", async () => {
      const env = await setupFiles(testDir, {
        "test.txt": "content\n",
      });
      await compareOutputs(env, testDir, "echo first; cat test.txt; echo last");
    });

    it("should continue after failure", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(
        env,
        testDir,
        'cat nonexistent.txt 2>/dev/null; echo "still runs"',
      );
    });
  });

  describe("combined operators", () => {
    it("should handle && and ||", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(
        env,
        testDir,
        'cat nonexistent.txt 2>/dev/null && echo "yes" || echo "no"',
      );
    });

    it("should handle ; and &&", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(env, testDir, 'echo "a"; echo "b" && echo "c"');
    });
  });
});

describe("Input Redirection (<) - Real Bash Comparison", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  describe("basic stdin redirection", () => {
    it("should redirect file to cat stdin", async () => {
      const env = await setupFiles(testDir, {
        "input.txt": "hello world\n",
      });
      await compareOutputs(env, testDir, "cat < input.txt");
    });

    it("should redirect file to grep stdin", async () => {
      const env = await setupFiles(testDir, {
        "input.txt": "apple\nbanana\napricot\ncherry\n",
      });
      await compareOutputs(env, testDir, "grep ^a < input.txt");
    });

    it("should redirect file to sort stdin", async () => {
      const env = await setupFiles(testDir, {
        "input.txt": "cherry\napple\nbanana\n",
      });
      await compareOutputs(env, testDir, "sort < input.txt");
    });

    it("should redirect file to wc stdin", async () => {
      const env = await setupFiles(testDir, {
        "input.txt": "line1\nline2\nline3\n",
      });
      // normalizeWhitespace needed because BSD/GNU wc have different column widths
      await compareOutputs(env, testDir, "wc -l < input.txt", {
        normalizeWhitespace: true,
      });
    });
  });

  describe("stdin redirection with output redirection", () => {
    it("should combine input and output redirection", async () => {
      const env = await setupFiles(testDir, {
        "input.txt": "cherry\napple\nbanana\n",
      });

      await env.exec("sort < input.txt > output.txt");
      await runRealBash("sort < input.txt > output.txt", testDir);

      const bashEnvContent = await env.readFile(
        path.join(testDir, "output.txt"),
      );
      const realContent = await fs.readFile(
        path.join(testDir, "output.txt"),
        "utf-8",
      );
      expect(bashEnvContent).toBe(realContent);
    });
  });

  describe("stdin redirection error handling", () => {
    it("should error on missing input file", async () => {
      const env = await setupFiles(testDir, {});
      const result = await env.exec("cat < nonexistent.txt");
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("No such file");
    });
  });
});
