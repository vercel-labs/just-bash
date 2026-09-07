import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

/**
 * Fixtures were recorded against GNU coreutils `yes` (BSD `yes` ignores every
 * operand but the first), and are locked so a macOS re-record cannot silently
 * replace them with BSD output.
 *
 * Only bounded consumers are compared: real `yes` never stops on its own, so
 * every case has to terminate the stream with `head`.
 */
describe("yes command - Real Bash Comparison", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  it("repeats y by default", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(env, testDir, "yes | head -3");
  });

  it("repeats a single operand", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(env, testDir, "yes n | head -2");
  });

  it("joins multiple operands with a space", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(env, testDir, "yes a b c | head -2");
  });

  it("keeps an empty operand as an empty line", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(env, testDir, "yes '' | head -2 | wc -c");
  });

  it("treats operands after -- literally", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(env, testDir, "yes -- -x | head -2");
  });

  it("treats a lone dash as an operand", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(env, testDir, "yes - | head -2");
  });

  it("feeds a long bounded read", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(env, testDir, "yes | head -5000 | wc -l");
  });

  it("auto-confirms a reader that counts confirmations", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(env, testDir, "yes yes | head -4 | sort -u");
  });
});
