import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

describe("nested shell options - Real Bash Comparison", () => {
  let testDir: string;
  beforeEach(async () => {
    testDir = await createTestDir();
  });
  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  it.each([
    "set -o pipefail; export SHELLOPTS; bash -c 'false | true; echo $?'",
    "set -o pipefail; export SHELLOPTS; export -n SHELLOPTS; bash -c 'false | true; echo $?'",
    "shopt -s nullglob; bash -c 'printf \"<%s>\\n\" missing-*'",
    "set -e; export SHELLOPTS; bash -c 'false; echo unreachable'; echo status=$?",
  ])("matches child startup for %s", async (script) => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(env, testDir, script);
  });
});
