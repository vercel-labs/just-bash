import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

describe("Pipeline cwd - Real Bash Comparison", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  it.each([
    "cd child | cat",
    "true | cd child",
    "true | cd child | cat",
    "{ cd child; exit 7; } | cat",
    "cd child | cat marker.txt",
    "cd child",
    "{ cd child; }",
  ])("preserves bash cwd semantics: %s", async (command) => {
    const bash = await setupFiles(testDir, {
      "marker.txt": "parent\n",
      "child/marker.txt": "child\n",
    });
    await compareOutputs(
      bash,
      testDir,
      `${command}; if [ "$PWD" = "$(pwd)" ]; then echo synced; else echo desynced; fi; cat marker.txt`,
    );
  });
});
