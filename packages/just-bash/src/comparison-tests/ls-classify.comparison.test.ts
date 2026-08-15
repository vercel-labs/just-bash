import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

/**
 * Type indicators belong to -F. Without it a listing carries names exactly as
 * they are spelled on disk, in long format as much as in short.
 *
 * Long format cannot be compared against the host's real `ls` — owner, mode
 * and size will not agree — so the long-format half of this rule is covered
 * by unit tests and these cases pin the short-format contract.
 */

const FILES = {
  "dir1/x.txt": "c\n",
  "f1.txt": "a\n",
};

describe("ls -F - Real Bash Comparison", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  it("should not mark directories without -F", async () => {
    const env = await setupFiles(testDir, FILES);
    await compareOutputs(env, testDir, "ls -1");
  });

  it("should mark directories with -F", async () => {
    const env = await setupFiles(testDir, FILES);
    await compareOutputs(env, testDir, "ls -1F");
  });
});
