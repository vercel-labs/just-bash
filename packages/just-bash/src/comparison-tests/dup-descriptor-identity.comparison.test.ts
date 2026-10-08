import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

/**
 * A duplication puts an fd on the open its source held when the dup ran, and
 * an fd number reused within one redirection list names two opens in turn, so
 * which streams end up together depends on the order of the list. Recorded
 * against GNU bash 3.2.57. `printf` without newlines keeps each file a single
 * token, so the check reads as `a=[..] b=[..]`.
 */

const BODY = "{ printf O; printf E >&2; }";
const SHOW = 'printf "a=[%s] b=[%s]\\n" "$(cat a)" "$(cat b)"';

describe("duplication descriptor identity - Real Bash Comparison", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  it("a reopened fd keeps the two dups' streams apart, first open from exec", async () => {
    const env = await setupFiles(testDir, { b: "" });
    await compareOutputs(
      env,
      testDir,
      `exec 3>a; ${BODY} 1>&3 3>b 2>&3; ${SHOW}`,
    );
  });

  it("a reopened fd keeps the two dups' streams apart, both opens in the list", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(env, testDir, `${BODY} 3>a 1>&3 3>b 2>&3; ${SHOW}`);
  });

  it("two dups of one exec'd open share it", async () => {
    const env = await setupFiles(testDir, { b: "" });
    await compareOutputs(env, testDir, `exec 3>a; ${BODY} 1>&3 2>&3; ${SHOW}`);
  });

  it("an alias that survives the reopen still shares the first open", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      `exec 3>a; exec 4>&3; ${BODY} 1>&3 3>b 2>&4; ${SHOW}`,
    );
  });

  it("a list dup taken before its source was reopened keeps the first open", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      `exec 3>a; ${BODY} 4>&3 3>b 1>&3 2>&4; ${SHOW}`,
    );
  });

  it("an fd re-pointed at another exec'd open keeps the two dups' streams apart", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      `exec 3>a; exec 4>b; ${BODY} 1>&3 3>&4 2>&3; ${SHOW}`,
    );
  });

  it("an eval script that exits keeps its write order through a group's duplication", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      "{ eval 'echo O1; echo E1 >&2; echo O2; exit'; } 2>&1",
    );
  });

  it("a stage that exits keeps its write order through a duplication into a pipe", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      "{ echo O1; echo E1 >&2; echo O2; exit 3; } 2>&1 | cat",
    );
  });

  it("a sourced file that returns keeps its write order through a duplication", async () => {
    const env = await setupFiles(testDir, {
      s: "echo O1\necho E1 >&2\necho O2\nreturn\n",
    });
    await compareOutputs(env, testDir, ". ./s 2>&1");
  });

  it("an executable script that exits keeps its write order through a duplication", async () => {
    const env = await setupFiles(testDir, {
      x: "#!/bin/bash\necho O1\necho E1 >&2\necho O2\nexit\n",
    });
    await compareOutputs(env, testDir, "chmod +x x; ./x 2>&1");
  });

  it("a nested shell that exits keeps its write order through a duplication", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      "bash -c 'echo O1; echo E1 >&2; echo O2; exit' 2>&1",
    );
  });

  it("an eval list that errexit ends keeps its write order through a duplication", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      "eval 'set -e; echo O1 && echo E1 >&2 && echo O2 && false' 2>&1",
    );
  });

  it("an exec'd 2>&1 puts fd 2 on fd 1's open for a nested shell's output", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      "( exec >f 2>&1; bash -c 'echo O1; echo E1 >&2; echo O2' ); cat f",
    );
  });

  it("an fd moved away within a list cannot be duplicated later in it", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      'echo hi 3>a 1>&3- 2>&3; echo "rc=$?"; cat a',
    );
  });
});
