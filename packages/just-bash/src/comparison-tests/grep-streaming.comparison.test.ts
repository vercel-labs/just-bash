import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

describe("grep streaming - Real Bash Comparison", () => {
  let testDir: string;
  beforeEach(async () => {
    testDir = await createTestDir();
  });
  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  it.each([
    "grep -n -C 1 MATCH a.txt b.txt | cat",
    "grep -c MATCH a.txt b.txt | cat",
    "grep -L MATCH a.txt b.txt | cat",
    "grep -n MATCH a.txt b.txt | head -2",
    "printf 'MATCH stdin\\n' | grep -n MATCH - a.txt - | cat",
  ])("preserves pipeline output: %s", async (command) => {
    const env = await setupFiles(testDir, {
      "a.txt": "before\nMATCH café\nafter\nMATCH 二\n",
      "b.txt": "nothing selected\n",
    });
    await compareOutputs(env, testDir, command, { compareStderr: true });
  });
});
