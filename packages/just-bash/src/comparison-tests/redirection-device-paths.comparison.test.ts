import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

describe("normalized redirection device paths - Real Bash Comparison", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  it.each([
    "cd /dev; echo hi > stdout",
    "echo hi > //dev/stdout",
    "echo hi > /dev/../dev/stderr",
    "cd /dev; echo hi >> ./stdout",
    "cd /dev; echo hi >| ./stderr",
    "cd /; echo hi > dev/null; wc -c < dev/null",
    "cd /dev; set -C; echo hi > ./null; wc -c < ./null",
  ])("%s", async (script) => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(env, testDir, script, {
      normalizeWhitespace: true,
      compareStderr: true,
    });
  });
});
