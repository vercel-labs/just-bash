import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

describe("export command - Real Bash Comparison", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  describe("setting variables", () => {
    it("should set and use a variable", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(env, testDir, "export FOO=bar; echo $FOO");
    });

    it("should set multiple variables", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(env, testDir, "export A=1 B=2 C=3; echo $A $B $C");
    });

    it("should handle value with equals sign", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(
        env,
        testDir,
        "export URL='http://x.com?a=1'; echo $URL",
      );
    });

    it("should handle empty value", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(env, testDir, 'export EMPTY=; echo "[$EMPTY]"');
    });
  });

  describe("variable usage", () => {
    it("should be available in subshell", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(env, testDir, "export FOO=bar; (echo $FOO)");
    });

    it("should work with test command", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(
        env,
        testDir,
        'export VAL=yes; [ "$VAL" = "yes" ] && echo matched',
      );
    });

    it("should work with numeric comparison", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(
        env,
        testDir,
        "export NUM=10; [ $NUM -gt 5 ] && echo greater",
      );
    });

    it("should work in string interpolation", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(
        env,
        testDir,
        'export NAME=world; echo "hello $NAME"',
      );
    });
  });

  describe("inline export", () => {
    it("should allow setting and using in same line", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(env, testDir, "export X=42 && echo $X");
    });
  });
});
