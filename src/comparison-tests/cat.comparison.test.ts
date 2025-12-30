import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./test-helpers.js";

describe("cat command - Real Bash Comparison", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  it("should match single file", async () => {
    const env = await setupFiles(testDir, {
      "test.txt": "line 1\nline 2\nline 3\n",
    });
    await compareOutputs(env, testDir, "cat test.txt");
  });

  it("should match multiple files", async () => {
    const env = await setupFiles(testDir, {
      "file1.txt": "content 1\n",
      "file2.txt": "content 2\n",
    });
    await compareOutputs(env, testDir, "cat file1.txt file2.txt");
  });

  it("should match -n (line numbers)", async () => {
    const env = await setupFiles(testDir, {
      "test.txt": "line 1\nline 2\nline 3\n",
    });
    await compareOutputs(env, testDir, "cat -n test.txt");
  });

  it("should match file without trailing newline", async () => {
    const env = await setupFiles(testDir, {
      "test.txt": "no trailing newline",
    });
    await compareOutputs(env, testDir, "cat test.txt");
  });

  it("should match empty file", async () => {
    const env = await setupFiles(testDir, {
      "empty.txt": "",
    });
    await compareOutputs(env, testDir, "cat empty.txt");
  });

  it("should match file with only newlines", async () => {
    const env = await setupFiles(testDir, {
      "newlines.txt": "\n\n\n",
    });
    await compareOutputs(env, testDir, "cat newlines.txt");
  });

  // Linux cat -n continues line numbers across files, macOS resets per file
  // BashEnv follows Linux behavior - fixture uses Linux output
  it("should match -n with multiple files", async () => {
    const env = await setupFiles(testDir, {
      "a.txt": "file a line 1\nfile a line 2\n",
      "b.txt": "file b line 1\n",
    });
    await compareOutputs(env, testDir, "cat -n a.txt b.txt");
  });

  it("should match cat with stdin from echo", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(env, testDir, 'echo "hello" | cat');
  });

  it("should match cat with stdin and file", async () => {
    const env = await setupFiles(testDir, {
      "test.txt": "from file\n",
    });
    await compareOutputs(env, testDir, 'echo "from stdin" | cat - test.txt');
  });
});
