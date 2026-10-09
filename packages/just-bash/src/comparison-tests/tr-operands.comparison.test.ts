import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

describe("tr operand validation - Real Bash Comparison", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  it.each([
    "echo é | tr 'é' X '\\377'",
    "echo é | tr -s 'é' X '\\377'",
    "echo é | tr -d 'é' '\\377'",
    "echo é | tr -ds 'é' X '\\377'",
    "echo abc | tr a X ignored",
  ])("rejects extra operands in %s", async (command) => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(env, testDir, command);
  });
});
