import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

describe("alias command - Real Bash Comparison", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  // Note: Alias expansion is not implemented in bash-env to match real bash behavior.
  // In non-interactive mode (scripts), bash does not expand aliases.

  describe("alias management", () => {
    it("should show alias not found error", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(env, testDir, "alias notexists || echo failed");
    });
  });

  describe("unalias", () => {
    it("should remove an alias", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(
        env,
        testDir,
        "alias greet='echo hi'; unalias greet; alias greet || echo removed",
      );
    });

    it("should error when unaliasing non-existent alias", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(
        env,
        testDir,
        "unalias nonexistent || echo not_found",
      );
    });
  });
});
