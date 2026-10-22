import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

const FILES = {
  "App Support (x) [y]/a.txt": "a",
  "App Support (x) [y]/b.md": "b",
  "e m/.keep": "",
  "s*t/k": "k",
};

describe("glob after a quoted directory - Real Bash Comparison", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  it.each([
    `printf '[%s]\\n' "App Support (x) [y]"/*`,
    `d="App Support (x) [y]"; for f in "$d"/*.txt; do echo "[$f]"; done`,
    `printf '[%s]\\n' "./App Support (x) [y]/"*.md`,
    `printf '[%s]\\n' 'App Support (x) [y]'/[ab].*`,
    `printf '[%s]\\n' App\\ Support\\ \\(x\\)\\ \\[y\\]/*`,
    `printf '[%s]\\n' "s*t"/*`,
    `printf '[%s]\\n' "e m"/*`,
    `printf '[%s]\\n' "no such (dir)"/*.txt "App Support (x) [y]"/*.csv`,
    `printf '[%s]\\n' 'a\\b'*`,
    `set -f; printf '[%s]\\n' "App Support (x) [y]"/* e\\ m/*`,
    `shopt -s nullglob; printf '[%s]\\n' "e m"/* "App Support (x) [y]"/*.md end`,
  ])("%s", async (command) => {
    const env = await setupFiles(testDir, FILES);
    await compareOutputs(env, testDir, command);
  });
});
