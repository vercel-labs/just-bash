import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

describe("command name expansion - Real Bash Comparison", () => {
  let testDirectory: string;

  beforeEach(async () => {
    testDirectory = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDirectory);
  });

  it("splits an unquoted variable into a command and its arguments", async () => {
    const env = await setupFiles(testDirectory, {});
    await compareOutputs(
      env,
      testDirectory,
      'CC="echo cc -O2"; $CC -c x.c; X="echo a b"; $X',
    );
  });

  it("splits $* and runs quoted $@ and array expansions", async () => {
    const env = await setupFiles(testDirectory, {});
    await compareOutputs(
      env,
      testDirectory,
      'set -- echo a b; $*; t() { shift; "$@"; }; t 5 echo c d; a=(echo x y); "${a[@]}"',
    );
  });

  it("runs the next word when the name expands to no fields", async () => {
    const env = await setupFiles(testDirectory, {});
    await compareOutputs(
      env,
      testDirectory,
      'set --; "$@" echo hi; x=; $x echo there; false; $x; echo "rc=$?"',
    );
  });

  it("does not find an empty or quoted name as a command", async () => {
    const env = await setupFiles(testDirectory, {});
    await compareOutputs(
      env,
      testDirectory,
      'x=; $x \'\' foo 2>/dev/null; echo "rc=$?"; y="echo a"; "$y" 2>/dev/null; echo "rc=$?"',
    );
  });

  it("applies brace expansion and globbing to the name", async () => {
    const env = await setupFiles(testDirectory, {
      echo: "",
      "echo-x": "",
    });
    await compareOutputs(
      env,
      testDirectory,
      '{echo,a} b; ech? hi; x="ech*"; $x hi; nomatch* hi 2>/dev/null; echo "rc=$?"',
    );
  });

  it("drops a name with no match under nullglob", async () => {
    const env = await setupFiles(testDirectory, {});
    await compareOutputs(
      env,
      testDirectory,
      "shopt -s nullglob; nomatch* echo hi; [ 1 = 1 ] && echo yes",
    );
  });
});
