import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

describe("test command - Real Bash Comparison", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  describe("file tests", () => {
    it("-e returns 0 for existing file", async () => {
      const env = await setupFiles(testDir, { "file.txt": "content" });
      await compareOutputs(env, testDir, "test -e file.txt && echo exists");
    });

    it("-e returns 1 for non-existing file", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(
        env,
        testDir,
        "test -e nonexistent && echo exists || echo missing",
      );
    });

    it("-f returns 0 for regular file", async () => {
      const env = await setupFiles(testDir, { "file.txt": "content" });
      await compareOutputs(
        env,
        testDir,
        "test -f file.txt && echo file || echo not",
      );
    });

    it("-f returns 1 for directory", async () => {
      const env = await setupFiles(testDir, { "dir/file.txt": "content" });
      await compareOutputs(
        env,
        testDir,
        "test -f dir && echo file || echo not",
      );
    });

    it("-d returns 0 for directory", async () => {
      const env = await setupFiles(testDir, { "dir/file.txt": "content" });
      await compareOutputs(env, testDir, "test -d dir && echo dir || echo not");
    });

    it("-d returns 1 for regular file", async () => {
      const env = await setupFiles(testDir, { "file.txt": "content" });
      await compareOutputs(
        env,
        testDir,
        "test -d file.txt && echo dir || echo not",
      );
    });

    it("-s returns 0 for non-empty file", async () => {
      const env = await setupFiles(testDir, { "file.txt": "content" });
      await compareOutputs(
        env,
        testDir,
        "test -s file.txt && echo nonempty || echo empty",
      );
    });

    it("-s returns 1 for empty file", async () => {
      const env = await setupFiles(testDir, { "empty.txt": "" });
      await compareOutputs(
        env,
        testDir,
        "test -s empty.txt && echo nonempty || echo empty",
      );
    });
  });

  describe("string tests", () => {
    it("-z returns 0 for empty string", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(
        env,
        testDir,
        'test -z "" && echo empty || echo nonempty',
      );
    });

    it("-z returns 1 for non-empty string", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(
        env,
        testDir,
        'test -z "hello" && echo empty || echo nonempty',
      );
    });

    it("-n returns 0 for non-empty string", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(
        env,
        testDir,
        'test -n "hello" && echo nonempty || echo empty',
      );
    });

    it("-n returns 1 for empty string", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(
        env,
        testDir,
        'test -n "" && echo nonempty || echo empty',
      );
    });

    it("= returns 0 for equal strings", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(
        env,
        testDir,
        'test "abc" = "abc" && echo equal || echo notequal',
      );
    });

    it("= returns 1 for unequal strings", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(
        env,
        testDir,
        'test "abc" = "def" && echo equal || echo notequal',
      );
    });

    it("!= returns 0 for unequal strings", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(
        env,
        testDir,
        'test "abc" != "def" && echo notequal || echo equal',
      );
    });

    it("!= returns 1 for equal strings", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(
        env,
        testDir,
        'test "abc" != "abc" && echo notequal || echo equal',
      );
    });
  });

  describe("numeric tests", () => {
    it("-eq returns 0 for equal numbers", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(
        env,
        testDir,
        "test 5 -eq 5 && echo equal || echo notequal",
      );
    });

    it("-eq returns 1 for unequal numbers", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(
        env,
        testDir,
        "test 5 -eq 6 && echo equal || echo notequal",
      );
    });

    it("-ne returns 0 for unequal numbers", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(
        env,
        testDir,
        "test 5 -ne 6 && echo notequal || echo equal",
      );
    });

    it("-lt returns 0 when left < right", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(
        env,
        testDir,
        "test 3 -lt 5 && echo less || echo notless",
      );
    });

    it("-lt returns 1 when left >= right", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(
        env,
        testDir,
        "test 5 -lt 3 && echo less || echo notless",
      );
    });

    it("-le returns 0 when left <= right", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(
        env,
        testDir,
        "test 5 -le 5 && echo lesseq || echo notlesseq",
      );
    });

    it("-gt returns 0 when left > right", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(
        env,
        testDir,
        "test 5 -gt 3 && echo greater || echo notgreater",
      );
    });

    it("-ge returns 0 when left >= right", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(
        env,
        testDir,
        "test 5 -ge 5 && echo greatereq || echo notgreatereq",
      );
    });
  });

  describe("logical operators", () => {
    it("! negates expression", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(
        env,
        testDir,
        'test ! -z "hello" && echo notempty || echo empty',
      );
    });

    it("-a requires both to be true", async () => {
      const env = await setupFiles(testDir, {
        "a.txt": "a",
        "b.txt": "b",
      });
      await compareOutputs(
        env,
        testDir,
        "test -f a.txt -a -f b.txt && echo both || echo notboth",
      );
    });

    it("-a fails if one is false", async () => {
      const env = await setupFiles(testDir, { "a.txt": "a" });
      await compareOutputs(
        env,
        testDir,
        "test -f a.txt -a -f nonexistent && echo both || echo notboth",
      );
    });

    it("-o succeeds if either is true", async () => {
      const env = await setupFiles(testDir, { "a.txt": "a" });
      await compareOutputs(
        env,
        testDir,
        "test -f nonexistent -o -f a.txt && echo either || echo neither",
      );
    });

    it("-o fails if both are false", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(
        env,
        testDir,
        "test -f a -o -f b && echo either || echo neither",
      );
    });
  });

  describe("bracket syntax [ ]", () => {
    it("works with closing bracket", async () => {
      const env = await setupFiles(testDir, { "file.txt": "content" });
      await compareOutputs(
        env,
        testDir,
        "[ -f file.txt ] && echo file || echo notfile",
      );
    });

    it("works with string comparison", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(
        env,
        testDir,
        '[ "foo" = "foo" ] && echo equal || echo notequal',
      );
    });

    it("works with numeric comparison", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(
        env,
        testDir,
        "[ 10 -gt 5 ] && echo greater || echo notgreater",
      );
    });

    it("works with logical operators", async () => {
      const env = await setupFiles(testDir, {
        "dir/file": "x",
      });
      await compareOutputs(
        env,
        testDir,
        "[ -d dir -a -f dir/file ] && echo both || echo notboth",
      );
    });
  });

  describe("no arguments", () => {
    it("returns 1 with no arguments", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(env, testDir, "test && echo true || echo false");
    });

    it("[ ] returns 1 with empty expression", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(env, testDir, "[ ] && echo true || echo false");
    });
  });

  describe("single argument", () => {
    it("returns 0 for non-empty string", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(
        env,
        testDir,
        'test "hello" && echo nonempty || echo empty',
      );
    });

    it("returns 1 for empty string", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(
        env,
        testDir,
        'test "" && echo nonempty || echo empty',
      );
    });
  });

  describe("variable expansion in test", () => {
    it("works with variable in string test", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(
        env,
        testDir,
        'VAR=hello; test -n "$VAR" && echo set || echo unset',
      );
    });

    it("works with empty variable", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(
        env,
        testDir,
        'VAR=""; test -z "$VAR" && echo empty || echo notempty',
      );
    });

    it("works with variable in numeric comparison", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(
        env,
        testDir,
        "NUM=10; test $NUM -gt 5 && echo greater || echo notgreater",
      );
    });
  });
});
