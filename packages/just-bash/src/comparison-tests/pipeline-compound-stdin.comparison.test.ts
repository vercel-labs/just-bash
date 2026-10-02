import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

/**
 * A compound command that sits after a `|` reads the pipe, whichever kind of
 * compound command it is: bash hands the previous stage's stdout to an `if`,
 * a `for`, or a `case` exactly as it does to a `while`, and to the file a
 * `source` runs. Recorded against GNU bash 3.2.57. Every command has its
 * stdin piped at the outermost level so recording never blocks on the
 * recorder's own stdin.
 */

describe("compound commands in a pipeline - Real Bash Comparison", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  it("an if body reads the pipe", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      'printf "a\\nb\\n" | if true; then read x; echo "if=[$x]"; fi',
    );
  });

  it("an if body reads the whole pipe through cat", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      'printf "a\\nb\\n" | if true; then cat; fi',
    );
  });

  it("an else body reads the pipe", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      'printf "a\\nb\\n" | if false; then :; else read x; echo "else=[$x]"; fi',
    );
  });

  it("a for body reads the pipe, and later iterations continue it", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      'printf "a\\nb\\n" | for i in 1 2 3; do read x; echo "for$i=[$x]"; done',
    );
  });

  it("a C-style for body reads the pipe", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      'printf "a\\nb\\n" | for ((i = 0; i < 2; i++)); do read x; echo "for$i=[$x]"; done',
    );
  });

  it("a case body reads the pipe", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      'printf "a\\nb\\n" | case y in y) read x; echo "case=[$x]" ;; esac',
    );
  });

  it("a compound command's own redirection wins over the pipe", async () => {
    const env = await setupFiles(testDir, { "own.txt": "own\n" });
    await compareOutputs(
      env,
      testDir,
      'printf "a\\nb\\n" | if true; then read x; echo "if=[$x]"; fi < own.txt',
    );
  });

  it("the pipe does not reach past the compound command", async () => {
    const env = await setupFiles(testDir, { "outer.txt": "outer\n" });
    await compareOutputs(
      env,
      testDir,
      '{ printf "a\\nb\\n" | if true; then read x; echo "if=[$x]"; fi; read y; echo "y=[$y]"; } < outer.txt',
    );
  });

  it("a sourced file reads the pipe", async () => {
    const env = await setupFiles(testDir, {
      "lib.sh": 'read x; echo "sourced=[$x]"\n',
    });
    await compareOutputs(env, testDir, 'printf "a\\nb\\n" | source ./lib.sh');
  });

  it("a sourced file's reads advance the shared position outside it", async () => {
    const env = await setupFiles(testDir, {
      "lib.sh": 'read x; echo "sourced=[$x]"\n',
    });
    await compareOutputs(
      env,
      testDir,
      'printf "a\\nb\\n" | { source ./lib.sh; read y; echo "y=[$y]"; }',
    );
  });

  it("an empty pipe is an empty stream, not the enclosing one", async () => {
    const env = await setupFiles(testDir, { "outer.txt": "outer\n" });
    await compareOutputs(
      env,
      testDir,
      '{ printf "" | if true; then read x; echo "if=[$x] status=$?"; fi; read y; echo "y=[$y]"; } < outer.txt',
    );
  });
});
