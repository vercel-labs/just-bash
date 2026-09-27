import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

/**
 * Fixtures were recorded against GNU coreutils `realpath` (BSD `realpath` only
 * understands `-q`) and are locked so a macOS re-record cannot replace them.
 *
 * Every case prints names relative to the test directory, because the absolute
 * answer necessarily differs between the real temporary directory and the
 * virtual filesystem.
 */
describe("realpath command - Real Bash Comparison", () => {
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

  describe("canonicalization", () => {
    it("resolves a relative name", async () => {
      const env = await setupFiles(testDir, files);
      await compareOutputs(env, testDir, "realpath --relative-to=. sub/f.txt");
    });

    it("collapses . and .. and duplicate slashes", async () => {
      const env = await setupFiles(testDir, files);
      await compareOutputs(
        env,
        testDir,
        "realpath --relative-to=. ./sub/..//other/./deep/g.txt",
      );
    });

    it("strips a trailing slash from a directory", async () => {
      const env = await setupFiles(testDir, files);
      await compareOutputs(
        env,
        testDir,
        "realpath --relative-to=. other/deep/",
      );
    });

    it("accepts a missing last component", async () => {
      const env = await setupFiles(testDir, files);
      await compareOutputs(
        env,
        testDir,
        "realpath --relative-to=. sub/new.txt",
      );
    });

    it("reports a missing intermediate component", async () => {
      const env = await setupFiles(testDir, files);
      await compareOutputs(
        env,
        testDir,
        "realpath nosuch/f.txt 2>&1; echo rc=$?",
      );
    });

    it("reports a path descending through a regular file", async () => {
      const env = await setupFiles(testDir, files);
      await compareOutputs(
        env,
        testDir,
        "realpath sub/f.txt/x 2>&1; echo rc=$?",
      );
    });

    it("resolves several operands at once", async () => {
      const env = await setupFiles(testDir, files);
      await compareOutputs(
        env,
        testDir,
        "realpath --relative-to=. sub/f.txt other/deep",
      );
    });
  });

  describe("existence policies", () => {
    it("-e rejects a missing name", async () => {
      const env = await setupFiles(testDir, files);
      await compareOutputs(
        env,
        testDir,
        "realpath -e sub/new.txt 2>&1; echo rc=$?",
      );
    });

    it("-e accepts an existing name", async () => {
      const env = await setupFiles(testDir, files);
      await compareOutputs(
        env,
        testDir,
        "realpath -e --relative-to=. sub/f.txt",
      );
    });

    it("-m accepts a fully missing path", async () => {
      const env = await setupFiles(testDir, files);
      await compareOutputs(
        env,
        testDir,
        "realpath -m --relative-to=. nosuch/deep/x",
      );
    });

    it("-m cancels .. inside a missing path", async () => {
      const env = await setupFiles(testDir, files);
      await compareOutputs(
        env,
        testDir,
        "realpath -m --relative-to=. nosuch/../x",
      );
    });

    it("-q suppresses the diagnostic", async () => {
      const env = await setupFiles(testDir, files);
      await compareOutputs(
        env,
        testDir,
        "realpath -q nosuch/x 2>&1; echo rc=$?",
      );
    });
  });

  describe("symlinks", () => {
    it("follows a relative symlink", async () => {
      const env = await setupFiles(testDir, files);
      await compareOutputs(
        env,
        testDir,
        "ln -s sub/f.txt link && realpath --relative-to=. link",
      );
    });

    it("follows a symlinked directory component", async () => {
      const env = await setupFiles(testDir, files);
      await compareOutputs(
        env,
        testDir,
        "ln -s other/deep d && realpath --relative-to=. d/g.txt",
      );
    });

    it("names the target of a dangling symlink", async () => {
      const env = await setupFiles(testDir, files);
      await compareOutputs(
        env,
        testDir,
        "ln -s nowhere dangling && realpath --relative-to=. dangling",
      );
    });

    it("rejects a dangling symlink under -e", async () => {
      const env = await setupFiles(testDir, files);
      await compareOutputs(
        env,
        testDir,
        "ln -s nowhere dangling && realpath -e dangling 2>&1; echo rc=$?",
      );
    });

    it("-s leaves a symlink unexpanded", async () => {
      const env = await setupFiles(testDir, files);
      await compareOutputs(
        env,
        testDir,
        "ln -s sub/f.txt link && realpath -s --relative-to=. link",
      );
    });

    it("-L resolves .. before the symlink", async () => {
      const env = await setupFiles(testDir, files);
      await compareOutputs(
        env,
        testDir,
        "ln -s other/deep d && realpath -L --relative-to=. d/..",
      );
    });

    it("resolves .. after the symlink by default", async () => {
      const env = await setupFiles(testDir, files);
      await compareOutputs(
        env,
        testDir,
        "ln -s other/deep d && realpath --relative-to=. d/..",
      );
    });

    it("reports a symlink loop", async () => {
      const env = await setupFiles(testDir, files);
      await compareOutputs(
        env,
        testDir,
        "ln -s loopb loopa && ln -s loopa loopb && realpath loopa 2>&1; echo rc=$?",
      );
    });
  });

  describe("relative output", () => {
    it("climbs out of the anchor directory", async () => {
      const env = await setupFiles(testDir, files);
      await compareOutputs(
        env,
        testDir,
        "realpath --relative-to=sub other/deep/g.txt",
      );
    });

    it("prints . for the anchor itself", async () => {
      const env = await setupFiles(testDir, files);
      await compareOutputs(env, testDir, "realpath --relative-to=sub sub");
    });

    it("takes the anchor as a separate argument", async () => {
      const env = await setupFiles(testDir, files);
      await compareOutputs(
        env,
        testDir,
        "realpath --relative-to sub sub/f.txt",
      );
    });

    it("keeps names outside --relative-base absolute", async () => {
      const env = await setupFiles(testDir, files);
      await compareOutputs(
        env,
        testDir,
        "realpath --relative-base=other sub/f.txt | grep -c '^/'",
      );
    });

    it("makes names under --relative-base relative", async () => {
      const env = await setupFiles(testDir, files);
      await compareOutputs(
        env,
        testDir,
        "realpath --relative-base=. other/deep/g.txt",
      );
    });

    it("-z terminates each name with NUL", async () => {
      const env = await setupFiles(testDir, files);
      await compareOutputs(
        env,
        testDir,
        "realpath -z --relative-to=. sub/f.txt other | wc -c",
      );
    });
  });
});
