import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

describe("jq raw input - Real Bash Comparison", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  describe("stdin", () => {
    it("should read stdin lines as strings with -R", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(env, testDir, "printf 'a\\nb\\n' | jq -R '.'");
    });

    it("should preserve blank lines with -R", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(env, testDir, "printf 'a\\n\\nb' | jq -R '.'");
    });

    it("should slurp raw stdin with -Rs", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(env, testDir, "printf 'a\\nb\\n' | jq -Rs '.'");
    });
  });

  describe("files", () => {
    it("should read files line by line with -R", async () => {
      const env = await setupFiles(testDir, {
        "a.txt": "first\n",
        "b.txt": "second",
      });
      await compareOutputs(env, testDir, "jq -R '.' a.txt b.txt");
    });

    it("should slurp files without separators with -Rs", async () => {
      const env = await setupFiles(testDir, {
        "a.txt": "first\n",
        "b.txt": "second",
      });
      await compareOutputs(env, testDir, "jq -Rs '.' a.txt b.txt");
    });

    it("should support stdin marker with files in raw mode", async () => {
      const env = await setupFiles(testDir, {
        "file.txt": "file\n",
      });
      await compareOutputs(
        env,
        testDir,
        "printf 'stdin\\n' | jq -R '.' - file.txt",
      );
    });
  });
});
