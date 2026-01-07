import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./test-helpers.js";

describe("strings command - Real Bash Comparison", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  it("should extract strings from text", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(env, testDir, "echo 'hello world' | strings");
  });

  it("should filter strings shorter than minimum length", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(env, testDir, "printf 'ab\\x00cd\\x00efgh' | strings");
  });

  it("should handle multiple strings", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      "printf 'hello\\x00\\x00world\\x00\\x00test' | strings",
    );
  });

  it("should change minimum length with -n", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      "printf 'ab\\x00cde\\x00fghi' | strings -n 3",
    );
  });

  it("should handle string at end without null terminator", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(env, testDir, "printf 'hello' | strings");
  });

  it("should read from file", async () => {
    const env = await setupFiles(testDir, {
      "test.bin": "hello\x00\x00\x00world",
    });
    await compareOutputs(env, testDir, "strings test.bin");
  });
});

describe("split command - Real Bash Comparison", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  it("should split file by lines and verify first chunk", async () => {
    const env = await setupFiles(testDir, {
      "test.txt": "1\n2\n3\n4\n5\n",
    });
    // Split into 2-line chunks and verify first output file
    await compareOutputs(env, testDir, "split -l 2 test.txt && cat xaa");
  });

  it("should split file by lines and verify second chunk", async () => {
    const env = await setupFiles(testDir, {
      "test.txt": "1\n2\n3\n4\n5\n",
    });
    await compareOutputs(env, testDir, "split -l 2 test.txt && cat xab");
  });

  it("should split by bytes and verify chunk", async () => {
    const env = await setupFiles(testDir, {
      "test.txt": "abcdefghij",
    });
    await compareOutputs(env, testDir, "split -b 4 test.txt && cat xaa");
  });

  it("should handle empty input", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(env, testDir, "printf '' | split");
  });

  it("should read from stdin and verify chunk", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      "printf 'a\\nb\\nc\\n' | split -l 1 && cat xaa",
    );
  });
});
