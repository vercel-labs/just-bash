import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

describe("sed global matches after gaps", () => {
  let testDir: string;
  beforeEach(async () => {
    testDir = await createTestDir();
  });
  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  for (const script of [
    "sed 's/a/X/g' input.txt",
    "sed 's/a*/X/g' input.txt",
    "sed 's/a\\|$/X/g' input.txt",
    "sed 's/\\(a*\\)/[\\1]/g' input.txt",
    "sed 's/a\\+/[&]/g' input.txt",
    "sed 's/a*/X/g; t yes; b; :yes; s/X/Y/g' input.txt",
  ]) {
    it(script, async () => {
      const env = await setupFiles(testDir, {
        "input.txt": "zzaabbaz\naba\nz\na\n\n",
      });
      await compareOutputs(env, testDir, script);
    });
  }
});
