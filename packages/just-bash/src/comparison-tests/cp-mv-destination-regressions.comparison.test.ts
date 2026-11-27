import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

describe("cp/mv destination regressions - Real Bash Comparison", () => {
  let testDirectory: string;

  beforeEach(async () => {
    testDirectory = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDirectory);
  });

  for (const operation of ["cp", "mv"]) {
    it(`${operation} accepts a nested source with a trailing slash`, async () => {
      const environment = await setupFiles(testDirectory, {
        "a/b/file": "payload\n",
        "destination/keep": "keep\n",
      });
      await compareOutputs(
        environment,
        testDirectory,
        `${operation === "cp" ? "cp -R" : "mv"} a/b/ destination; echo status:$?`,
      );
    });

    it(`${operation} rejects an empty destination and retains the source`, async () => {
      const environment = await setupFiles(testDirectory, {
        source: "payload\n",
      });
      await compareOutputs(
        environment,
        testDirectory,
        `${operation} source "" 2>/dev/null; echo status:$?; cat source`,
      );
    });

    it(`${operation} allows a destination reached through a symlink out of the source`, async () => {
      const environment = await setupFiles(testDirectory, {
        "source/nested": "payload\n",
        "outside/dir/keep": "keep\n",
      });
      await compareOutputs(
        environment,
        testDirectory,
        `ln -s ../outside/dir source/link; ${operation === "cp" ? "cp -R" : "mv"} source source/link/../copied; echo status:$?; cat outside/copied/nested`,
      );
    });
  }
});
