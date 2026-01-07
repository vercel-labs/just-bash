import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./test-helpers.js";

describe("rev command - Real Bash Comparison", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  it("should reverse simple string from stdin", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(env, testDir, "echo 'hello' | rev");
  });

  it("should reverse multiple lines", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(env, testDir, "printf 'abc\\ndef\\nghi\\n' | rev");
  });

  it("should handle empty input", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(env, testDir, "printf '' | rev");
  });

  it("should handle single character", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(env, testDir, "echo 'a' | rev");
  });

  it("should preserve spaces", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(env, testDir, "echo 'a b c' | rev");
  });
});

describe("nl command - Real Bash Comparison", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  it("should number lines from stdin", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(env, testDir, "printf 'a\\nb\\nc\\n' | nl");
  });

  it("should skip empty lines with default style", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(env, testDir, "printf 'a\\n\\nb\\n' | nl");
  });

  it("should number all lines with -ba", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(env, testDir, "printf 'a\\n\\nb\\n' | nl -ba");
  });

  it("should left justify with -n ln", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(env, testDir, "printf 'a\\nb\\n' | nl -n ln");
  });

  it("should right justify with zeros with -n rz", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(env, testDir, "printf 'a\\nb\\n' | nl -n rz");
  });

  it("should set width with -w", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(env, testDir, "printf 'a\\nb\\n' | nl -w 3");
  });

  it("should set separator with -s", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(env, testDir, "printf 'a\\nb\\n' | nl -s ': '");
  });

  it("should set starting number with -v", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(env, testDir, "printf 'a\\nb\\n' | nl -v 10");
  });

  it("should set increment with -i", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(env, testDir, "printf 'a\\nb\\nc\\n' | nl -i 5");
  });
});

describe("fold command - Real Bash Comparison", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  it("should wrap at 80 columns by default", async () => {
    const env = await setupFiles(testDir, {});
    const longLine = "a".repeat(100);
    await compareOutputs(env, testDir, `echo '${longLine}' | fold`);
  });

  it("should wrap at specified width with -w", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(env, testDir, "echo 'hello world test' | fold -w 5");
  });

  it("should break at spaces with -s", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      "echo 'hello world foo bar' | fold -sw 10",
    );
  });

  it("should handle empty input", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(env, testDir, "printf '' | fold");
  });

  it("should handle multiple lines", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      "printf '12345678901234567890\\nabcdefghij\\n' | fold -w 10",
    );
  });
});

describe("expand command - Real Bash Comparison", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  it("should convert tabs to 8 spaces by default", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(env, testDir, "printf 'a\\tb' | expand");
  });

  it("should handle tab at start of line", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(env, testDir, "printf '\\thello' | expand");
  });

  it("should handle multiple tabs", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(env, testDir, "printf 'a\\tb\\tc' | expand");
  });

  it("should use custom tab width with -t", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(env, testDir, "printf 'a\\tb' | expand -t 4");
  });

  it("should handle input with no tabs", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(env, testDir, "printf 'hello world' | expand");
  });
});

describe("unexpand command - Real Bash Comparison", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  it("should convert leading spaces to tabs (default 8)", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(env, testDir, "printf '        hello' | unexpand");
  });

  it("should handle partial tab stops", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(env, testDir, "printf '    hello' | unexpand");
  });

  it("should handle 16 leading spaces", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      "printf '                hello' | unexpand",
    );
  });

  it("should not convert spaces after text by default", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      "printf 'hello        world' | unexpand",
    );
  });

  it("should convert all spaces with -a", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(env, testDir, "printf 'hello   world' | unexpand -a");
  });

  it("should use custom tab width with -t", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(env, testDir, "printf '    hello' | unexpand -t 4");
  });
});
