import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

/**
 * Two properties of a command substitution inside `$(( ))` that the state-sharing
 * fix has to preserve: it is still a subshell (its mutations are discarded), and
 * its output is still *data* (bash re-parses it as arithmetic but does not run
 * expansions on it, so a `$(...)` reached that way is a syntax error).
 *
 * The array-subscript case is the documented exception - bash does expand a
 * subscript reached through data. See spec-tests bugs.test.sh, which records
 * that as bash behaviour.
 */
describe("arithmetic command substitution isolation - GNU Bash Comparison", () => {
  let testDirectory: string;

  beforeEach(async () => {
    testDirectory = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDirectory);
  });

  describe("subshell isolation is preserved", () => {
    it("discards assignments made inside the substitution", async () => {
      const env = await setupFiles(testDirectory, {});
      await compareOutputs(
        env,
        testDirectory,
        'K=1\necho $(( $(K=99; echo 2) ))\necho "K=$K"',
      );
    });

    it("discards a cd made inside the substitution", async () => {
      const env = await setupFiles(testDirectory, {});
      await compareOutputs(
        env,
        testDirectory,
        'mkdir -p deep\nbefore=$PWD\necho $(( $(cd deep; echo 1) ))\ntest "$PWD" = "$before" && echo same',
      );
    });

    it("discards a function defined inside the substitution", async () => {
      const env = await setupFiles(testDirectory, {});
      await compareOutputs(
        env,
        testDirectory,
        "echo $(( $(f() { :; }; echo 1) ))\ntype f >/dev/null 2>&1 && echo leaked || echo isolated",
      );
    });

    it("discards a shell option set inside the substitution", async () => {
      const env = await setupFiles(testDirectory, {});
      await compareOutputs(
        env,
        testDirectory,
        'echo $(( $(set -u; echo 1) ))\necho "[$UNSET_VAR] status=$?"',
      );
    });

    it("discards a shopt set inside the substitution", async () => {
      const env = await setupFiles(testDirectory, {});
      await compareOutputs(
        env,
        testDirectory,
        "echo $(( $(shopt -s nullglob; echo 1) ))\nshopt -q nullglob && echo leaked || echo isolated",
      );
    });

    it("discards a variable attribute set inside the substitution", async () => {
      const env = await setupFiles(testDirectory, {});
      await compareOutputs(
        env,
        testDirectory,
        'echo $(( $(declare -i N; echo 1) ))\nN="2+3"\necho "N=$N"',
      );
    });
  });

  describe("substitution output is data, not script", () => {
    it("rejects a substitution reached through variable indirection", async () => {
      const env = await setupFiles(testDirectory, {});
      await compareOutputs(
        env,
        testDirectory,
        'a=\'$(echo 1)\'\nb=a\necho "[$(( b ))]"\necho "status=$?"',
      );
    });

    it("rejects a substitution present in the substitution output", async () => {
      const env = await setupFiles(testDirectory, {});
      await compareOutputs(
        env,
        testDirectory,
        'v=\'$(echo 1)\'\necho "[$(( $(echo v) ))]"\necho "status=$?"',
      );
    });

    it("still expands a substitution in an array subscript from data", async () => {
      const env = await setupFiles(testDirectory, {});
      await compareOutputs(
        env,
        testDirectory,
        "a=(0 1 2)\nb=(3 4 5)\nsub='a[$(echo 2)]'\necho \"${b[sub]}\"",
      );
    });
  });
});
