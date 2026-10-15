import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

/**
 * A PATH search runs the first executable it finds and skips directories.
 * When no executable exists, the first file without execute permission makes
 * the command fail with status 126 instead of 127, and `hash` does not
 * remember it. Recorded against GNU bash 5.2.21.
 */

const files = {
  "a/tool": "echo a\n",
  "e/tool": "echo e\n",
  "d/tool/.keep": "",
};

describe("PATH search - Real Bash Comparison", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  it("fails with 126 for a file without execute permission", async () => {
    const env = await setupFiles(testDir, files);
    await compareOutputs(
      env,
      testDir,
      'P=$PATH; PATH=a; tool; s=$?; PATH=$P; echo "status=$s"',
    );
  });

  it("runs a later executable instead of an earlier file without execute permission", async () => {
    const env = await setupFiles(testDir, files);
    await compareOutputs(
      env,
      testDir,
      'chmod +x e/tool; PATH=a:e:$PATH; tool; echo "status=$?"',
    );
  });

  it("skips directories", async () => {
    const env = await setupFiles(testDir, files);
    await compareOutputs(
      env,
      testDir,
      'chmod +x e/tool; P=$PATH; PATH=d:e:$P; tool; PATH=d; tool; s=$?; PATH=$P; echo "status=$s"',
    );
  });

  it("does not hash a file without execute permission", async () => {
    const env = await setupFiles(testDir, files);
    await compareOutputs(
      env,
      testDir,
      'P=$PATH; PATH=a; hash tool; s=$?; PATH=$P; echo "status=$s"',
    );
  });
});
