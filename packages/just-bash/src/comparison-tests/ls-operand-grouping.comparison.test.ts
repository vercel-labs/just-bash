import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

/**
 * Operand grouping pinned against the host's real `ls`: file operands as one
 * unseparated block, directories after them under a label.
 *
 * Long format is deliberately absent: owner, mode and size cannot agree with
 * the host's real `ls`, which is why every case here is short format.
 */

describe("ls operand grouping - Real Bash Comparison", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  it("should not separate file operands", async () => {
    const env = await setupFiles(testDir, {
      "f1.txt": "a\n",
      "f2.txt": "b\n",
    });
    await compareOutputs(env, testDir, "ls -1 f1.txt f2.txt");
  });

  it("should not separate file operands reached through expansion", async () => {
    const env = await setupFiles(testDir, {
      "a.pdf": "a\n",
      "b.pdf": "b\n",
      "c.pdf": "c\n",
    });
    await compareOutputs(env, testDir, "ls -1 *.pdf");
  });

  it("should print files before directories", async () => {
    const env = await setupFiles(testDir, {
      "f1.txt": "a\n",
      "dir1/x.txt": "c\n",
    });
    await compareOutputs(env, testDir, "ls -1 dir1 f1.txt");
  });

  it("should separate directory groups", async () => {
    const env = await setupFiles(testDir, {
      "dir1/x.txt": "c\n",
      "dir2/y.txt": "d\n",
    });
    await compareOutputs(env, testDir, "ls -1 dir1 dir2");
  });

  it("should leave a lone directory operand unlabeled", async () => {
    const env = await setupFiles(testDir, {
      "dir1/x.txt": "c\n",
    });
    await compareOutputs(env, testDir, "ls -1 dir1");
  });

  it("should keep -d operands in one block", async () => {
    const env = await setupFiles(testDir, {
      "f1.txt": "a\n",
      "dir1/x.txt": "c\n",
      "dir2/y.txt": "d\n",
    });
    await compareOutputs(env, testDir, "ls -1d dir2 f1.txt dir1");
  });
});
