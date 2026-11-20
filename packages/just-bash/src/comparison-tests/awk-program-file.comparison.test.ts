import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

describe("awk program files - Real Bash Comparison", () => {
  let testDir: string;
  beforeEach(async () => {
    testDir = await createTestDir();
  });
  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  it("combines program files and keeps options and data operands", async () => {
    const env = await setupFiles(testDir, {
      "first.awk": "BEGIN {print prefix} # comment\n",
      "second.awk": "{print $2}",
      data: "one,two\nthree,four\n",
    });
    await compareOutputs(
      env,
      testDir,
      "awk -f first.awk -fsecond.awk -F, -v prefix=hello data",
    );
  });

  it("consumes stdin as program input", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      "echo 'BEGIN {print 1} {print 2}' | awk -f -",
    );
  });
});
