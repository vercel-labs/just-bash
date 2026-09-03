import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

/**
 * The parts of GNU `realpath` that are easy to get wrong: `.` and `..` require
 * a directory in front of them, a trailing slash requires one too but tolerates
 * a name that is absent, `-s` still refuses to descend through a non-directory,
 * and `-L` validates whatever it cancels.
 *
 * Fixtures were recorded against GNU coreutils (BSD `realpath` only understands
 * `-q`) and are locked so a macOS re-record cannot replace them.
 */
describe("realpath path semantics - Real Bash Comparison", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  const files = {
    "sub/f.txt": "hi\n",
    "other/deep/g.txt": "there\n",
  };

  describe(". and .. components", () => {
    it("rejects file/.", async () => {
      const env = await setupFiles(testDir, files);
      await compareOutputs(
        env,
        testDir,
        "realpath sub/f.txt/. 2>&1; echo rc=$?",
      );
    });

    it("rejects file/..", async () => {
      const env = await setupFiles(testDir, files);
      await compareOutputs(
        env,
        testDir,
        "realpath sub/f.txt/.. 2>&1; echo rc=$?",
      );
    });

    it("rejects a missing name before .", async () => {
      const env = await setupFiles(testDir, files);
      await compareOutputs(env, testDir, "realpath nosuch/. 2>&1; echo rc=$?");
    });

    it("accepts file/. under -m", async () => {
      const env = await setupFiles(testDir, files);
      await compareOutputs(
        env,
        testDir,
        "realpath -m --relative-to=. sub/f.txt/.",
      );
    });

    it("accepts dir/. under -e", async () => {
      const env = await setupFiles(testDir, files);
      await compareOutputs(env, testDir, "realpath -e --relative-to=. sub/.");
    });

    it("tolerates a trailing slash on a missing name", async () => {
      const env = await setupFiles(testDir, files);
      await compareOutputs(env, testDir, "realpath --relative-to=. nosuchdir/");
    });
  });

  describe("symlinks named as directories", () => {
    it("rejects a trailing slash on a link to a file", async () => {
      const env = await setupFiles(testDir, files);
      await compareOutputs(
        env,
        testDir,
        "ln -s sub/f.txt link && realpath link/ 2>&1; echo rc=$?",
      );
    });

    it("rejects a target that names a regular file as a directory", async () => {
      const env = await setupFiles(testDir, files);
      await compareOutputs(
        env,
        testDir,
        "ln -s 'sub/f.txt/' fileslash && realpath fileslash 2>&1; echo rc=$?",
      );
    });

    it("tolerates a target that names a missing directory", async () => {
      const env = await setupFiles(testDir, files);
      await compareOutputs(
        env,
        testDir,
        "ln -s 'nosuch/' missingslash && realpath --relative-to=. missingslash",
      );
    });
  });

  describe("-s keeps the directory requirement", () => {
    it("refuses to descend through a regular file", async () => {
      const env = await setupFiles(testDir, files);
      await compareOutputs(
        env,
        testDir,
        "realpath -s sub/f.txt/x 2>&1; echo rc=$?",
      );
    });

    it("refuses a trailing slash on a regular file", async () => {
      const env = await setupFiles(testDir, files);
      await compareOutputs(
        env,
        testDir,
        "realpath -s sub/f.txt/ 2>&1; echo rc=$?",
      );
    });

    it("follows a link only for the directory test", async () => {
      const env = await setupFiles(testDir, files);
      await compareOutputs(
        env,
        testDir,
        "ln -s sub/f.txt link && realpath -s link/.. 2>&1; echo rc=$?",
      );
    });

    it("descends through a link to a directory", async () => {
      const env = await setupFiles(testDir, files);
      await compareOutputs(
        env,
        testDir,
        "ln -s other/deep d && realpath -s --relative-to=. d/g.txt",
      );
    });

    it("checks no intermediate component for existence", async () => {
      const env = await setupFiles(testDir, files);
      await compareOutputs(
        env,
        testDir,
        "realpath -s --relative-to=. nosuch/x/y",
      );
    });

    it("checks the finished name under -e", async () => {
      const env = await setupFiles(testDir, files);
      await compareOutputs(
        env,
        testDir,
        "realpath -s -e nosuch/x 2>&1; echo rc=$?",
      );
    });
  });

  describe("-L validates what it cancels", () => {
    it("rejects a link to a regular file before ..", async () => {
      const env = await setupFiles(testDir, files);
      await compareOutputs(
        env,
        testDir,
        "ln -s sub/f.txt link && realpath -L link/.. 2>&1; echo rc=$?",
      );
    });

    it("rejects a missing name before ..", async () => {
      const env = await setupFiles(testDir, files);
      await compareOutputs(
        env,
        testDir,
        "realpath -L nosuch/.. 2>&1; echo rc=$?",
      );
    });

    it("cancels a missing name under -m", async () => {
      const env = await setupFiles(testDir, files);
      await compareOutputs(
        env,
        testDir,
        "realpath -L -m --relative-to=. nosuch/..",
      );
    });

    it("keeps . harmless in the middle of a path", async () => {
      const env = await setupFiles(testDir, files);
      await compareOutputs(
        env,
        testDir,
        "realpath -L --relative-to=. sub/./f.txt",
      );
    });

    it("leaves .. at the root at the root", async () => {
      const env = await setupFiles(testDir, files);
      await compareOutputs(env, testDir, "realpath -L /..");
    });

    it("cancels a link to a directory and resolves the rest", async () => {
      const env = await setupFiles(testDir, files);
      await compareOutputs(
        env,
        testDir,
        "ln -s other/deep d && realpath -L --relative-to=. d/../sub/f.txt",
      );
    });
  });
});
