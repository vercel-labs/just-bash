import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

describe("byte escapes that spell UTF-8 - Real Bash Comparison", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  it("should print a character given as octal in a printf format", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(env, testDir, "printf '\\303\\251\\n' | cat -v");
  });

  it("should print a character given as mixed hex and octal", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(env, testDir, "printf '\\xc3\\251\\n' | cat -v");
  });

  it("should print a character given as octal in a %b argument", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      "printf '%b|%b\\n' '\\0303\\0251' '\\303\\251' | cat -v",
    );
  });

  it("should print a character given as octal or hex to echo -e", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      "echo -e '\\0303\\0251|\\xc3\\xa9' | cat -v",
    );
  });

  it("should print a character given as octal in $'...'", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      "echo $'\\303\\251|\\342\\202\\254' | cat -v",
    );
  });

  it("should write two bytes for a two-byte character", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      "printf '\\303\\251' | wc -c | tr -d ' '",
    );
  });

  it("should read one-digit hex escapes", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(env, testDir, "printf 'a\\x9z\\n' | cat -vt");
  });

  it("should keep a % made by an escape literal", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      "printf '\\045s|\\x25s|\\445s\\n' a b c",
    );
  });

  it("should end a $'...' hex escape at a non-hex character", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(env, testDir, "echo $'\\x4g' | cat -v");
  });
});
