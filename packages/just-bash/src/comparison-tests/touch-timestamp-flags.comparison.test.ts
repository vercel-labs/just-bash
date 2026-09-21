import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

/**
 * `touch -t` and `touch -r` observed through `find -newer`.
 *
 * A timestamp cannot be compared against the host directly — `ls -l` renders
 * owner and size, which will never agree — so each case stamps the files and
 * then asks which of them came out newer. A stamp that is ignored leaves
 * every file with the same current time and the answer collapses, which is
 * what these cases catch.
 *
 * `-d` is absent for a different reason: BSD touch rejects the bare
 * `YYYY-MM-DD` spelling GNU accepts, so the host cannot record a fixture for
 * it on macOS. Unit tests cover that spelling against measured GNU output.
 */

const FILES = {
  "alpha.txt": "a\n",
  "bravo.txt": "b\n",
  "charlie.txt": "c\n",
};

const NEWER_THAN_BRAVO = "find . -newer bravo.txt -name '*.txt' | sort";

describe("touch timestamp flags - Real Bash Comparison", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  it("should stamp a four-digit-year time", async () => {
    const env = await setupFiles(testDir, FILES);
    await compareOutputs(
      env,
      testDir,
      "touch -t 202601010000 alpha.txt && " +
        "touch -t 202301010000 bravo.txt && " +
        `touch -t 202001010000 charlie.txt && ${NEWER_THAN_BRAVO}`,
    );
  });

  it("should stamp a two-digit-year time", async () => {
    const env = await setupFiles(testDir, FILES);
    await compareOutputs(
      env,
      testDir,
      "touch -t 2601010000 alpha.txt && " +
        "touch -t 2301010000 bravo.txt && " +
        `touch -t 2001010000 charlie.txt && ${NEWER_THAN_BRAVO}`,
    );
  });

  it("should stamp seconds when the stamp carries them", async () => {
    const env = await setupFiles(testDir, FILES);
    await compareOutputs(
      env,
      testDir,
      "touch -t 202601010000.30 alpha.txt && " +
        "touch -t 202601010000.20 bravo.txt && " +
        `touch -t 202601010000.10 charlie.txt && ${NEWER_THAN_BRAVO}`,
    );
  });

  it("should copy a reference file's time with -r", async () => {
    const env = await setupFiles(testDir, FILES);
    await compareOutputs(
      env,
      testDir,
      "touch -t 202601010000 charlie.txt && " +
        "touch -t 202301010000 bravo.txt && " +
        `touch -r charlie.txt alpha.txt && ${NEWER_THAN_BRAVO}`,
    );
  });
});
