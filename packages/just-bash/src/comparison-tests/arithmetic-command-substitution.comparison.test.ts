import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

/**
 * A `$(...)` / backtick substitution nested inside `$(( ))` or `(( ))` runs in
 * the current shell state, so it sees everything the script has assigned. It
 * used to run in a detached shell seeded from the initial environment, which
 * silently produced a plausible wrong number.
 *
 * Reported downstream as ai-ecoverse/slicc#2978.
 */
describe("arithmetic command substitution - GNU Bash Comparison", () => {
  let testDirectory: string;

  beforeEach(async () => {
    testDirectory = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDirectory);
  });

  describe("variable visibility", () => {
    it("sees a plain variable assigned by the script", async () => {
      const env = await setupFiles(testDirectory, {});
      await compareOutputs(
        env,
        testDirectory,
        'X=abc\necho $(( $(echo "$X" | wc -c) ))',
      );
    });

    it("does not fall back to a default for a variable that is set", async () => {
      const env = await setupFiles(testDirectory, {});
      await compareOutputs(
        env,
        testDirectory,
        "X=abc\necho $(( $(echo ${X:-DEFAULT} | wc -c) ))",
      );
    });

    it("sees an exported variable", async () => {
      const env = await setupFiles(testDirectory, {});
      await compareOutputs(
        env,
        testDirectory,
        'export EE=zz\necho $(( $(echo "${EE:-none}" | wc -c) ))',
      );
    });

    it("sees a function defined by the script", async () => {
      const env = await setupFiles(testDirectory, {});
      await compareOutputs(
        env,
        testDirectory,
        "f() { echo 5; }\necho $(( $(f) + 1 ))",
      );
    });

    it("sees a variable assigned inside a function body", async () => {
      const env = await setupFiles(testDirectory, {});
      await compareOutputs(
        env,
        testDirectory,
        'g() { local L=wxyz; echo $(( $(echo "$L" | wc -c) )); }\ng',
      );
    });

    it("sees the script's working directory", async () => {
      const env = await setupFiles(testDirectory, { "sub/marker.txt": "m\n" });
      await compareOutputs(
        env,
        testDirectory,
        "cd sub\necho $(( $(ls | wc -l) ))",
      );
    });
  });

  describe("every arithmetic entry point agrees", () => {
    it("evaluates the backtick form", async () => {
      const env = await setupFiles(testDirectory, {});
      await compareOutputs(
        env,
        testDirectory,
        'X=abc\necho $(( `echo "$X" | wc -c` ))',
      );
    });

    it("evaluates the (( )) command form", async () => {
      const env = await setupFiles(testDirectory, {});
      await compareOutputs(
        env,
        testDirectory,
        'X=abc\n(( n = $(echo "$X" | wc -c) ))\necho $n',
      );
    });

    it("evaluates the let form", async () => {
      const env = await setupFiles(testDirectory, {});
      await compareOutputs(
        env,
        testDirectory,
        'X=abc\nlet "m = $(echo "$X" | wc -c)"\necho $m',
      );
    });

    it("evaluates the assignment form", async () => {
      const env = await setupFiles(testDirectory, {});
      await compareOutputs(
        env,
        testDirectory,
        'X=abc\na=$(( $(echo "$X" | wc -c) ))\necho $a',
      );
    });

    it("evaluates an array subscript", async () => {
      const env = await setupFiles(testDirectory, {});
      await compareOutputs(
        env,
        testDirectory,
        'arr=(zero one two three)\nX=ab\necho ${arr[$(echo "$X" | wc -c)]}',
      );
    });
  });

  describe("quoting is preserved", () => {
    it("keeps repeated spaces inside a quoted substitution argument", async () => {
      const env = await setupFiles(testDirectory, {});
      await compareOutputs(
        env,
        testDirectory,
        'Q="a  b"\necho $(( $(printf %s "$Q" | wc -c) ))',
      );
    });

    it("does not re-expand variable data as shell syntax in the backtick form", async () => {
      const env = await setupFiles(testDirectory, {});
      await compareOutputs(
        env,
        testDirectory,
        "Q='$(echo PWNED)'\necho $(( `printf %s \"$Q\" | wc -c` ))",
      );
    });

    it("does not re-expand variable data as shell syntax in the $() form", async () => {
      const env = await setupFiles(testDirectory, {});
      await compareOutputs(
        env,
        testDirectory,
        "Q='$(echo PWNED)'\necho $(( $(printf %s \"$Q\" | wc -c) ))",
      );
    });
  });

  describe("nesting", () => {
    it("evaluates a substitution nested in a substitution", async () => {
      const env = await setupFiles(testDirectory, {});
      await compareOutputs(
        env,
        testDirectory,
        'X=7\necho $(( $(echo $(echo "$X")) ))',
      );
    });

    it("evaluates arithmetic nested inside the substitution", async () => {
      const env = await setupFiles(testDirectory, {});
      await compareOutputs(
        env,
        testDirectory,
        "X=4\necho $(( $(echo $(( X * 2 ))) + 1 ))",
      );
    });
  });

  describe("substitution output is spliced as arithmetic, not parseInt'd", () => {
    it("evaluates an operator expression in the output", async () => {
      const env = await setupFiles(testDirectory, {});
      await compareOutputs(env, testDirectory, 'echo $(( $(echo "1 + 2") ))');
    });

    it("trims surrounding whitespace", async () => {
      const env = await setupFiles(testDirectory, {});
      await compareOutputs(env, testDirectory, 'echo $(( $(echo " 7 ") ))');
    });

    it("reads a bare word in the output as a variable name", async () => {
      const env = await setupFiles(testDirectory, {});
      await compareOutputs(env, testDirectory, "v=9\necho $(( $(echo v) ))");
    });

    it("honours hex notation in the output", async () => {
      const env = await setupFiles(testDirectory, {});
      await compareOutputs(env, testDirectory, 'echo $(( $(echo "0x10") ))');
    });

    it("honours octal notation in the output", async () => {
      const env = await setupFiles(testDirectory, {});
      await compareOutputs(env, testDirectory, 'echo $(( $(echo "010") ))');
    });
  });

  describe("empty and failing substitutions", () => {
    it("treats empty output as 0 when it is the whole expression", async () => {
      const env = await setupFiles(testDirectory, {});
      await compareOutputs(env, testDirectory, 'echo $(( $(echo "") ))');
    });

    it("treats a silent successful command as 0", async () => {
      const env = await setupFiles(testDirectory, {});
      await compareOutputs(env, testDirectory, "echo $(( $(true) ))");
    });

    it("treats a failing command with no output as 0", async () => {
      const env = await setupFiles(testDirectory, {});
      await compareOutputs(env, testDirectory, "echo $(( $(false) ))");
    });

    it("adds an empty operand as 0", async () => {
      const env = await setupFiles(testDirectory, {});
      await compareOutputs(env, testDirectory, 'echo $(( $(echo "") + 1 ))');
    });
  });
});
