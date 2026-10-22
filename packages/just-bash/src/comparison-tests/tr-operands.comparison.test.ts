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

  it.each([
    "tr '\\037-\\001' X",
    "tr 'z-\\n' X",
    "tr X '\\t-\\0'",
    "tr -d '\\177-~'",
    "tr -s '\\200-\\177'",
    "tr -ds X '\\377-\\200'",
    "tr 'z-a' X",
    "tr 'z- ' X",
    "tr '\\\\-A' X",
  ])("formats reversed range endpoints in %s", async (command) => {
    const env = await setupFiles(testDir, {});
    // The comparison runner checks stdout, so include the diagnostic there.
    await compareOutputs(env, testDir, `${command} 2>&1`);
  });
});
