import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

describe("cut lines without the delimiter - Real Bash Comparison", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  it("prints a line without the delimiter whole", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(env, testDir, "printf 'a:b\\nc\\n' | cut -d: -f2");
  });

  it("prints such a line whole for a first-field list", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      "printf 'a:b:c\\nplain\\n' | cut -d: -f1",
    );
  });

  it("prints such a line whole for an open range", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      "printf 'a:b:c\\nplain\\n' | cut -d: -f2-",
    );
  });

  it("keeps empty lines", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      "printf 'a:b\\n\\nc:d\\n' | cut -d: -f2",
    );
  });

  it("applies to the default tab delimiter", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(env, testDir, "printf 'a\\tb\\nplain\\n' | cut -f2");
  });

  it("suppresses such lines with -s", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(env, testDir, "printf 'a:b\\nc\\n' | cut -s -d: -f2");
  });
});
