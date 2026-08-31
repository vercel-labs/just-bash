import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

describe("cp/mv destination traversal - Real Bash Comparison", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  for (const operation of ["cp", "mv"]) {
    for (const destination of ["missing/", "blocking/", "existing/"]) {
      it(`${operation} a file to ${destination}`, async () => {
        const environment = await setupFiles(testDir, {
          source: "payload\n",
          blocking: "original\n",
          "existing/keep": "keep\n",
        });
        await compareOutputs(
          environment,
          testDir,
          `
          ${operation} source ${destination} 2>/dev/null
          echo "status=$?"
          test -f source; echo "source=$?"
          test -f missing; echo "missing-file=$?"
          test -f existing/source; echo "copied-file=$?"
          cat blocking
        `,
        );
      });
    }

    it(`${operation} a directory to a new trailing-slash destination`, async () => {
      const environment = await setupFiles(testDir, {
        "source/nested": "payload\n",
      });
      await compareOutputs(
        environment,
        testDir,
        `
        ${operation === "cp" ? "cp -r" : "mv"} source missing/ 2>/dev/null
        echo "status=$?"
        test -d source; echo "source=$?"
        cat missing/nested
      `,
      );
    });

    it(`${operation} follows a directory symlink before dot-dot`, async () => {
      const environment = await setupFiles(testDir, {
        source: "payload\n",
        "real/dir/keep": "keep\n",
        copied: "original\n",
      });
      await compareOutputs(
        environment,
        testDir,
        `
        ln -s real/dir link
        ${operation} source link/../copied
        echo "status=$?"
        cat real/copied
        cat copied
        test -f source; echo "source=$?"
      `,
      );
    });

    it(`${operation} detects the destination directory after resolving dot-dot`, async () => {
      const environment = await setupFiles(testDir, {
        source: "payload\n",
        "real/dir/keep": "keep\n",
        "real/destination/keep": "keep\n",
      });
      await compareOutputs(
        environment,
        testDir,
        `
        ln -s real/dir link
        ${operation} source link/../destination
        echo "status=$?"
        cat real/destination/source
        test -f destination; echo "wrong-destination=$?"
      `,
      );
    });
  }
});
