import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

// Recorded with GNU sed 4.9 first on PATH. The fixtures are locked because
// BSD sed rejects a number together with g, and the t and T scripts.
describe("sed s with a number", () => {
  let testDir: string;
  beforeEach(async () => {
    testDir = await createTestDir();
  });
  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  for (const script of [
    "sed 's/a/b/2g' input.txt",
    "sed 's/a/b/5g' input.txt",
    "sed 's/\\(a\\)/[\\1&]/2g' input.txt",
    "sed 's/b*/x/3' input.txt",
    "sed 's/b*/x/2g' input.txt",
    "sed -n 's/a/b/3p' input.txt",
    "sed -n 's/a/b/2gp' input.txt",
    "sed -n 's/a/a/2p' input.txt",
    "sed 's/a/b/2;tx;s/$/ -/;b;:x;s/$/ +/' input.txt",
    "sed 's/a/b/3;Tx;s/$/ +/;b;:x;s/$/ -/' input.txt",
    "sed 's/a/b/;Tx;s/a/c/5;Ty;s/$/ -/;b;:x;s/$/ x/;b;:y;s/$/ y/' input.txt",
  ]) {
    it(script, async () => {
      const env = await setupFiles(testDir, {
        "input.txt": "x\na\naaa\naaaa\nabc\n\n",
      });
      await compareOutputs(env, testDir, script);
    });
  }
});
