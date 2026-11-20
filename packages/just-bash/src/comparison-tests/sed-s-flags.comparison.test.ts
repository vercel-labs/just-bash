import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

// Fixtures recorded with GNU sed 4.9 and locked.
describe("sed s command flags", () => {
  let testDir: string;
  beforeEach(async () => {
    testDir = await createTestDir();
  });
  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  it("keeps the file when text follows the flags in sed -i", async () => {
    const env = await setupFiles(testDir, { "test.txt": "a\nb\n" });
    await compareOutputs(
      env,
      testDir,
      "sed -i '1s#a#x\\n# default#' test.txt; echo \"exit $?\"; cat test.txt",
    );
  });

  it("keeps a trailing blank delimiter in a sed -f script", async () => {
    const env = await setupFiles(testDir, {
      "script.sed": "s a b \n",
      "test.txt": "aaa\nb\n",
    });
    await compareOutputs(env, testDir, "sed -f script.sed test.txt");
  });

  for (const script of [
    "sed 's/a/b/ g' test.txt",
    "sed -n 's/a/b/g p' test.txt",
    "sed 's/a/b/ 2' test.txt",
    "sed 's/a/b/g ; p' test.txt",
    "sed 's/a/b/ # comment' test.txt",
    "sed '/a/{s/a/x/ }' test.txt",
    "sed 's/a/b/d' test.txt",
    "sed 's/a/b' test.txt",
    "sed 's/a/b/gg' test.txt",
    "sed 's/a/b/1g2' test.txt",
    "sed 's/a/b/0' test.txt",
  ]) {
    it(script, async () => {
      const env = await setupFiles(testDir, { "test.txt": "aaa\nb\n" });
      await compareOutputs(env, testDir, script);
    });
  }
});
