import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

describe("tail -c +N - Real Bash Comparison", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  it("starts at byte N", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(env, testDir, "printf 'one\\ntwo\\n' | tail -c +4");
  });

  it("prints everything for +1", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(env, testDir, "printf 'one\\ntwo\\n' | tail -c +1");
  });

  it("prints everything for +0", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(env, testDir, "printf 'one\\ntwo\\n' | tail -c +0");
  });

  it("prints the last byte for +SIZE", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(env, testDir, "printf 'one\\ntwo\\n' | tail -c +8");
  });

  it("prints nothing beyond the end", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(env, testDir, "printf 'one\\ntwo\\n' | tail -c +100");
  });

  it("accepts the long form", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      "printf 'one\\ntwo\\n' | tail --bytes=+5",
    );
  });

  it("still prints the last N bytes without +", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(env, testDir, "printf 'one\\ntwo\\n' | tail -c 4");
  });
});
