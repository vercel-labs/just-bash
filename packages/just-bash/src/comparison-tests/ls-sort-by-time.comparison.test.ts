import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

/**
 * `-t` ordering pinned against the host's real `ls`.
 *
 * The fixture files are created together, so their timestamps are set inside
 * the compared command itself. `touch -d` with a full ISO 8601 stamp is the
 * one spelling GNU and BSD touch both accept.
 */

const FILES = {
  "big-old.txt": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n",
  "small-new.txt": "a\n",
  "mid-b.txt": "bb\n",
};

const STAMP = [
  "touch -d 2020-01-01T00:00:00 big-old.txt",
  "touch -d 2026-01-01T00:00:00 small-new.txt",
  "touch -d 2023-01-01T00:00:00 mid-b.txt",
].join(" && ");

describe("ls -t - Real Bash Comparison", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  it("should list newest first", async () => {
    const env = await setupFiles(testDir, FILES);
    await compareOutputs(env, testDir, `${STAMP} && ls -1t`);
  });

  it("should reverse under -tr", async () => {
    const env = await setupFiles(testDir, FILES);
    await compareOutputs(env, testDir, `${STAMP} && ls -1tr`);
  });

  it("should let -t win when it follows -S", async () => {
    const env = await setupFiles(testDir, FILES);
    await compareOutputs(env, testDir, `${STAMP} && ls -1St`);
  });

  it("should let -S win when it follows -t", async () => {
    const env = await setupFiles(testDir, FILES);
    await compareOutputs(env, testDir, `${STAMP} && ls -1tS`);
  });

  it("should order file operands by time", async () => {
    const env = await setupFiles(testDir, FILES);
    await compareOutputs(
      env,
      testDir,
      `${STAMP} && ls -1t big-old.txt small-new.txt`,
    );
  });
});
