import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

describe("jq positional-argument flags - Real Bash Comparison", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  describe("--args", () => {
    it("collects string positional args", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(
        env,
        testDir,
        "jq -cn '$ARGS.positional' --args a b c",
      );
    });

    it("keeps numeric-looking positionals as strings", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(
        env,
        testDir,
        "jq -cn '$ARGS.positional' --args 1 2 3",
      );
    });

    it("treats the first token after --args as the filter", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(
        env,
        testDir,
        "jq -cn --args '$ARGS.positional' a b c",
      );
    });
  });

  describe("--jsonargs", () => {
    it("parses JSON positional args", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(
        env,
        testDir,
        "jq -cn '$ARGS.positional' --jsonargs 1 '\"x\"' true",
      );
    });

    it("parses JSON objects and arrays", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(
        env,
        testDir,
        "jq -cn '$ARGS.positional' --jsonargs '{\"a\":1}' '[1,2]'",
      );
    });

    it("errors non-zero on invalid JSON", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(
        env,
        testDir,
        "jq -n '$ARGS.positional' --jsonargs 1 notjson",
      );
    });
  });

  describe("combinations", () => {
    it("populates both named and positional", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(env, testDir, "jq -cn '$ARGS' --arg k v --args a b");
    });

    it("switches between --args and --jsonargs", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(
        env,
        testDir,
        "jq -cn '$ARGS.positional' --args a --jsonargs 1",
      );
    });

    it("does not treat positionals as input files", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(
        env,
        testDir,
        "echo '{\"v\":1}' | jq -c '.v' --args a b",
      );
    });
  });
});
