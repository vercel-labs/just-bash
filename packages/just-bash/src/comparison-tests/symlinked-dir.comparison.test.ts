import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

describe("writes through a symlinked directory - Real Bash Comparison", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  it("should change the real directory", async () => {
    const env = await setupFiles(testDir, {
      "real/f.txt": "old\n",
    });
    await compareOutputs(
      env,
      testDir,
      [
        "ln -s real lnk",
        "echo new > lnk/a.txt",
        "echo more >> lnk/a.txt",
        "mkdir lnk/sub",
        "touch lnk/t.txt",
        "cp lnk/f.txt lnk/copy.txt",
        "mv lnk/copy.txt lnk/moved.txt",
        "rm lnk/f.txt",
        "ls real",
        "cat real/a.txt",
      ].join("; "),
    );
  });
});
