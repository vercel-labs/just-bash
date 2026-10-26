import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

describe("awk integer truncation - Real Bash Comparison", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  it("int() truncates toward zero", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      `awk 'BEGIN { print int(-3.7), int(-0.5), int(3.7), int("-2.9x") }'`,
    );
  });

  it("printf %d and %i truncate toward zero", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      `awk 'BEGIN { printf "%d %i %d %d %5d|\\n", -3.7, -3.7, -0.5, 3.7, -2.5 }'`,
    );
  });
});
