import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

// GNU cp is the reference. BSD cp has no --force, and its -n and -f override
// each other by order, so those fixtures are locked to GNU coreutils output.
describe("cp -f - Real Bash Comparison", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  it.each([
    "cp -f src.txt dst.txt; echo $?; cat dst.txt",
    "cp --force src.txt dst.txt; echo $?; cat dst.txt",
    "cp -pf src.txt dst.txt; echo $?; cat dst.txt",
    "chmod 444 dst.txt; cp -f src.txt dst.txt; echo $?; cat dst.txt",
  ])("should overwrite with %s", async (command) => {
    const env = await setupFiles(testDir, {
      "src.txt": "new\n",
      "dst.txt": "old\n",
    });
    await compareOutputs(env, testDir, command);
  });

  it.each([
    "cp -rf src dst; echo $?; cat dst/src/a.txt",
    "cp -fR src dst; echo $?; cat dst/src/a.txt",
  ])("should copy recursively with %s", async (command) => {
    const env = await setupFiles(testDir, {
      "src/a.txt": "new\n",
      "dst/src/a.txt": "old\n",
    });
    await compareOutputs(env, testDir, command);
  });

  it.each([
    "cp -nf src.txt dst.txt; echo $?; cat dst.txt",
    "cp -fn src.txt dst.txt; echo $?; cat dst.txt",
  ])("should let -n win with %s", async (command) => {
    const env = await setupFiles(testDir, {
      "src.txt": "new\n",
      "dst.txt": "old\n",
    });
    await compareOutputs(env, testDir, command);
  });
});
