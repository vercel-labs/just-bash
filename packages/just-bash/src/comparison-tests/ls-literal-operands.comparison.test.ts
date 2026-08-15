import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

/**
 * Names holding glob metacharacters are ordinary names to `ls`. The shell has
 * already finished pathname expansion by the time the command runs, so these
 * operands must be resolved literally rather than matched a second time.
 *
 * Long format is deliberately absent: owner, mode and size cannot agree with
 * the host's real `ls`, which is why every case here is short format.
 */

describe("ls literal operands - Real Bash Comparison", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  it("should list a bracketed name given literally", async () => {
    const env = await setupFiles(testDir, {
      "report [1].pdf": "body\n",
    });
    await compareOutputs(env, testDir, "ls 'report [1].pdf'");
  });

  it("should list a bracketed name reached through expansion", async () => {
    const env = await setupFiles(testDir, {
      "report [1].pdf": "body\n",
      "notes.txt": "body\n",
    });
    await compareOutputs(env, testDir, "ls -1 *.pdf");
  });

  it("should list a name holding a question mark", async () => {
    const env = await setupFiles(testDir, {
      "q?mark.txt": "body\n",
    });
    await compareOutputs(env, testDir, "ls 'q?mark.txt'");
  });

  it("should list a name holding an asterisk", async () => {
    const env = await setupFiles(testDir, {
      "star*x.txt": "body\n",
    });
    await compareOutputs(env, testDir, "ls 'star*x.txt'");
  });
});
