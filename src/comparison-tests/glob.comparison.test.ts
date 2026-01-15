import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./test-helpers.js";

describe("glob expansion - Real Bash Comparison", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  it("should expand single-level glob pattern", async () => {
    const env = await setupFiles(testDir, {
      "file1.txt": "content 1",
      "file2.txt": "content 2",
      "file3.json": "{}",
    });
    await compareOutputs(env, testDir, "echo *.txt");
  });

  it("should expand multi-level glob pattern with wildcard directory", async () => {
    const env = await setupFiles(testDir, {
      "folder1/data.json": '{"a":1}',
      "folder2/data.json": '{"b":2}',
      "folder3/other.txt": "text",
    });
    await compareOutputs(env, testDir, "echo */*.json");
  });

  it("should expand multi-level glob pattern with absolute path", async () => {
    const env = await setupFiles(testDir, {
      "dm/folder1/data.json": '{"a":1}',
      "dm/folder2/data.json": '{"b":2}',
      "dm/folder3/other.txt": "text",
    });
    await compareOutputs(env, testDir, "cat dm/*/*.json");
  });

  it("should expand triple-level glob pattern", async () => {
    const env = await setupFiles(testDir, {
      "a/b/c/file.txt": "abc",
      "a/d/e/file.txt": "ade",
      "x/y/z/file.txt": "xyz",
    });
    await compareOutputs(env, testDir, "echo */*/*/*.txt");
  });

  it("should expand glob with question mark", async () => {
    const env = await setupFiles(testDir, {
      "file1.txt": "1",
      "file2.txt": "2",
      "file10.txt": "10",
    });
    await compareOutputs(env, testDir, "echo file?.txt");
  });

  it("should expand glob with character class", async () => {
    const env = await setupFiles(testDir, {
      "file1.txt": "1",
      "file2.txt": "2",
      "file3.txt": "3",
      "filea.txt": "a",
    });
    await compareOutputs(env, testDir, "echo file[12].txt");
  });

  it("should return pattern when no matches", async () => {
    const env = await setupFiles(testDir, {
      "file.txt": "content",
    });
    await compareOutputs(env, testDir, "echo *.xyz");
  });

  it("should expand glob with grep command", async () => {
    const env = await setupFiles(testDir, {
      "dir1/file.txt": "hello world",
      "dir2/file.txt": "hello there",
      "dir3/other.txt": "goodbye",
    });
    await compareOutputs(env, testDir, "grep hello */*.txt");
  });

  it("should expand glob at root level with subdirectory pattern", async () => {
    const env = await setupFiles(testDir, {
      "src/a/test.ts": "test a",
      "src/b/test.ts": "test b",
      "lib/c/test.ts": "test c",
    });
    await compareOutputs(env, testDir, "echo */*/test.ts");
  });

  it("should handle mixed glob and literal segments", async () => {
    const env = await setupFiles(testDir, {
      "data/v1/config.json": "v1 config",
      "data/v2/config.json": "v2 config",
      "data/v1/settings.json": "v1 settings",
    });
    await compareOutputs(env, testDir, "cat data/*/config.json");
  });
});
