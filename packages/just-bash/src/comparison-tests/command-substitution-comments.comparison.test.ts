import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

// The fixtures are recorded with GNU bash 5.2. macOS /bin/bash 3.2 reads some
// of these scripts differently, so those entries are locked.
describe("Command substitution comments - Real Bash Comparison", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  it("runs the rest of the script after a # in nested quotes", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      'x=$(echo "$(echo "#a")")\necho "after x=[$x]"\nexit 7',
    );
  });

  it("keeps a # inside a word", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      `x=$(echo a-#b 1#b 'q'#b "q"#b \\ #c {#d); echo "[$x]"; echo after`,
    );
  });

  it("keeps a # after an expansion", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      'set -- a b; v=1; x=$(echo $# ${v}#a $(echo b)#c $((2))#d); echo "[$x]"; echo after',
    );
  });

  it("keeps a # after an equals sign", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(env, testDir, 'x=$(a=#b; echo "$a"); echo "[$x]"');
  });

  it("joins a word across a line continuation", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(env, testDir, 'x=$(echo a\\\n#c); echo "[$x]"');
  });

  it("reads nested double quotes", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      'x=$(echo "$(echo "$(echo "#deep")")" "x$(echo "#a")y"); echo "[$x]"',
    );
  });

  it("finds the closing paren after a paren in nested quotes", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      'x=$(echo "$(echo ")")" "$(echo "(")"); echo "[$x]"',
    );
  });

  it("restores the case state after nested quotes", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      'x=$(echo "$(case a in a) echo "#y";; esac)"; case x in "$(echo x)") echo "#m";; esac); echo "[$x]"',
    );
  });

  it("reads a here-string in nested quotes", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      'v=abc\nx=$(\n  y="$(cat <<<"$v")"\n  echo "$y"\n)\necho "[$x]"',
    );
  });

  it("finds a heredoc after a $(( subshell in nested quotes", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      'x=$(echo "$((echo a) )"\ncat <<E\n)\nE\n)\necho "[$x]"',
    );
  });

  it("fails when the input ends inside $(", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(env, testDir, "x=$(echo a # )\necho after");
  });

  it("keeps an outer heredoc open across a newline in nested quotes", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      `x=$(cat <<E; echo "$(echo a\n)"\nit's\nE\n)\necho "[$x]"`,
    );
  });

  it("runs the next command after an unclosed $( in eval", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      "echo start; eval 'x=$(echo a # )'; echo end",
    );
  });

  it("starts a comment at the start of the body and after ; | &&", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      'x=$(#c\necho a;#c\necho b|#c\ncat&&#c\necho c); echo "[$x]"',
    );
  });

  it("starts a comment after a subshell and after a case pattern", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      'x=$( (echo a)#c\ncase b in b)#c\necho b;; esac); echo "[$x]"',
    );
  });

  it("starts a comment after a line continuation", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(env, testDir, 'x=$(echo a \\\n#c\n); echo "[$x]"');
  });

  it("keeps the # in ${#v} and in a heredoc body", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      'v=hello; x=$(echo ${#v}; cat <<\'E\'\n#a "b\nE\n); echo "[$x]"',
    );
  });
});
