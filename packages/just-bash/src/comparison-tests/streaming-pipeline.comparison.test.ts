import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

describe("Streaming pipelines - Real Bash Comparison", () => {
  let testDir: string;
  beforeEach(async () => {
    testDir = await createTestDir();
  });
  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  for (const command of [
    "seq 5 | cat | head -n 2",
    "seq -w 8 12 | cat",
    "seq 5 | sort -r | head -n 2",
    "seq 5 | head -c 3",
    "printf 'héllo\\nworld\\n' | cat | head -n 1",
    "! seq 3 | cat",
    "seq 3 | cat; echo ${PIPESTATUS[*]}",
    "set -o pipefail; seq 2 | head -n 1; echo $?:${PIPESTATUS[*]}",
    "set -o pipefail; seq 5 | head -n 2; echo $?:${PIPESTATUS[*]}",
    "set -euo pipefail; seq 5 | head -n 2; echo survived",
    "set -o pipefail; seq 100 | head -n 1; echo $?:${PIPESTATUS[*]}",
  ]) {
    it(command, async () => {
      const bash = await setupFiles(testDir, {});
      await compareOutputs(bash, testDir, command);
    });
  }
});
