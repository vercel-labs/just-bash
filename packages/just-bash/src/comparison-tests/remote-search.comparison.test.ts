import { afterEach, beforeEach, describe, it } from "vitest";
import { Bash } from "../Bash.js";
import { remoteFs } from "../test-utils/remote-fs.js";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

describe("remote search command comparison", () => {
  let testDir: string;
  beforeEach(async () => {
    testDir = await createTestDir();
  });
  afterEach(async () => {
    await cleanupTestDir(testDir);
  });
  it("matches native grep", async () => {
    const command = "grep -nE 'foo|bar' a.txt b.txt";
    const files = { "a.txt": "foo\nbar\n", "b.txt": "other\n" };
    await setupFiles(testDir, files);
    const remote = remoteFs(
      Object.fromEntries(
        Object.entries(files).map(([path, content]) => [
          `${testDir}/${path}`,
          content,
        ]),
      ),
    );
    await compareOutputs(
      new Bash({ fs: remote.fs, cwd: testDir }),
      testDir,
      command,
    );
  });
});
