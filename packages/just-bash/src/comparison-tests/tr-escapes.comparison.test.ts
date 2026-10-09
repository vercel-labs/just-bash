import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

describe("tr escape sequences - Real Bash Comparison", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  it("should translate to a carriage return given in octal", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(env, testDir, "echo X | tr X '\\015' | cat -v");
  });

  it("should translate to a printable character given in octal", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(env, testDir, "echo abc | tr b '\\101'");
  });

  it("should delete a range of control characters", async () => {
    const env = await setupFiles(testDir, {
      "test.txt": "a\x01B\x1fc\n",
    });
    await compareOutputs(env, testDir, "cat test.txt | tr -d '\\000-\\037'");
  });

  it("should translate between octal ranges", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(env, testDir, "echo xyz | tr 'x-z' '\\101-\\103'");
  });

  it("should decode short octal escapes", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      "echo a8bc | tr '8bc' '\\18\\60' | cat -v",
    );
  });

  it("should decode control-character escapes", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      "echo abcd | tr 'abcd' '\\a\\b\\f\\v' | cat -v",
    );
  });

  it("should decode an escaped backslash", async () => {
    const env = await setupFiles(testDir, {
      "test.txt": "a\\b\n",
    });
    await compareOutputs(env, testDir, "cat test.txt | tr '\\\\' '/'");
  });

  it.each([
    "echo abc | tr -d '\\101-\\077'",
    "echo abc | tr -d 'z-a'",
    "echo abc | tr 'a' 'z-a'",
    "echo abc | tr '\\141-\\141' X",
  ])("should match GNU tr for %s", async (command) => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(env, testDir, command);
  });
});
