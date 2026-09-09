import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

/**
 * `stat -c` is GNU-only, so these fixtures were recorded from GNU coreutils
 * 9.2 and locked. Timestamp directives are left out: they cannot be compared
 * against a recording. They are covered in `commands/stat/stat.format.test.ts`.
 */
describe("stat -c - Real Bash Comparison", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  it("prints the size", async () => {
    const env = await setupFiles(testDir, { "file.txt": "hello world" });
    await compareOutputs(env, testDir, "stat -c '%s' file.txt");
  });

  it("prints mode and type for a file", async () => {
    const env = await setupFiles(testDir, { "file.txt": "hello world" });
    await compareOutputs(env, testDir, "stat -c '%a %A %f %F' file.txt");
  });

  it("prints mode and type for a directory", async () => {
    const env = await setupFiles(testDir, { "dir/file.txt": "hello" });
    await compareOutputs(env, testDir, "stat -c '%a %A %f %F' dir");
  });

  it("prints a literal percent, and ? for an unknown directive", async () => {
    const env = await setupFiles(testDir, { "file.txt": "hello world" });
    await compareOutputs(env, testDir, "stat -c 'pct=%% unknown=%q' file.txt");
  });

  it("pads a directive to a width, on either side", async () => {
    const env = await setupFiles(testDir, { "file.txt": "hello world" });
    await compareOutputs(env, testDir, "stat -c '[%5s][%-5s]' file.txt");
  });

  it("prints a percent that runs off the end of FORMAT as itself", async () => {
    const env = await setupFiles(testDir, { "file.txt": "hello world" });
    await compareOutputs(env, testDir, "stat -c 'trailing %' file.txt");
  });
});
