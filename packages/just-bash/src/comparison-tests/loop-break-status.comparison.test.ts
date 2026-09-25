import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

/**
 * A loop left via `break`/`continue` reports the status of the builtin (0),
 * not of the last command that ran before it:
 *
 *   while :; do false; break; done; echo $?   # 0, not 1
 *
 * `break`/`continue` return 0 and are themselves the last command the body
 * runs, so a later iteration may still overwrite that status - `continue`
 * must not pin the loop to 0 either. Recorded against GNU bash 3.2.57.
 */

describe("loop break/continue exit status - Real Bash Comparison", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  // --- break: the failing command before it must not leak out -------------

  it("while: break after a failed command reports 0", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      "while :; do false; break; done; echo $?",
    );
  });

  it("until: break after a failed command reports 0", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      "until false; do false; break; done; echo $?",
    );
  });

  it("for: break after a failed command reports 0", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      "for i in 1 2; do false; break; done; echo $?",
    );
  });

  it("c-style for: break after a failed command reports 0", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      "for ((i = 0; i < 3; i++)); do false; break; done; echo $?",
    );
  });

  it("while: break with no preceding command still reports 0", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(env, testDir, "while :; do break; done; echo $?");
  });

  it("break nested in if and case still reports 0", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      "for i in 1; do if :; then false; break; fi; done; echo $?; " +
        "for i in 1; do case $i in 1) false; break;; esac; done; echo $?",
    );
  });

  // --- continue: 0 at the point of the builtin, but not pinned ------------

  it("for: continue after a failed command reports 0", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      "for i in 1 2; do false; continue; done; echo $?",
    );
  });

  it("while: continue after a failed command reports 0", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      "n=0; while [ $n -lt 2 ]; do n=$((n + 1)); false; continue; done; echo $?",
    );
  });

  it("until: continue after a failed command reports 0", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      "n=0; until [ $n -ge 2 ]; do n=$((n + 1)); false; continue; done; echo $?",
    );
  });

  it("c-style for: continue after a failed command reports 0", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      "for ((i = 0; i < 2; i++)); do false; continue; done; echo $?",
    );
  });

  it("a later iteration still overwrites the status set by continue", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      "for i in 1 2; do if [ $i = 1 ]; then true; continue; fi; false; done; echo $?",
    );
  });

  // `$?` is read as the body's *first* command, so it carries over from the
  // previous iteration - reading it after any other command would only show
  // that command's status and hide a stale value.

  it("for: continue leaves $? as 0 for the next iteration", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      'for i in 1 2; do echo "$i:$?"; false; continue; done; echo $?',
    );
  });

  it("c-style for: continue leaves $? as 0 for the next iteration", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      'for ((i = 0; i < 2; i++)); do echo "$i:$?"; false; continue; done; echo $?',
    );
  });

  it("while: continue leaves $? as 0 for the next iteration", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      'n=0; while [ $n -lt 2 ]; do echo "$n:$?"; n=$((n + 1)); false; continue; done; echo $?',
    );
  });

  it("until: continue leaves $? as 0 for the next iteration", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      'n=0; until [ $n -ge 2 ]; do echo "$n:$?"; n=$((n + 1)); false; continue; done; echo $?',
    );
  });

  it("continue 2 leaves $? as 0 in the outer loop's next iteration", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      'for i in 1 2; do echo "$i:$?"; for j in 1; do false; continue 2; done; done; echo $?',
    );
  });

  it("$? after an inner loop left via break is 0", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      'for i in 1; do for j in 1; do false; break; done; echo "after=$?"; done',
    );
  });

  // --- multi-level break/continue -----------------------------------------

  it("break 2 reports 0 for both loops", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      "for i in 1; do for j in 1; do false; break 2; done; done; echo $?",
    );
  });

  it("break 3 out of three nested loops reports 0", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      "for a in 1; do for b in 1; do for c in 1; do false; break 3; done; done; done; echo $?",
    );
  });

  it("break with more levels than enclosing loops reports 0", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      "for a in 1; do false; break 5; done; echo $?",
    );
  });

  it("break 1 in an inner loop leaves the outer loop at 0", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      "for i in 1; do for j in 1; do false; break; done; done; echo $?",
    );
  });

  it("continue 2 reports 0 after resuming the outer loop", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      "for i in 1 2; do for j in 1; do false; continue 2; done; done; echo $?",
    );
  });

  // --- break/continue inside a while condition ----------------------------

  it("break in a while condition reports 0", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      "while false || { false; break; }; do :; done; echo $?",
    );
  });

  it("continue in a while condition reports 0", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      "n=0; while { n=$((n + 1)); [ $n -lt 3 ] && { false; continue; }; }; do :; done; echo $?",
    );
  });

  // --- unchanged neighbours: a loop that ends normally keeps its status ---

  it("a loop that ends normally still reports its last command", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      "for i in 1 2; do false; done; echo $?; " +
        "n=0; while [ $n -lt 2 ]; do n=$((n + 1)); false; done; echo $?; " +
        "for i in; do false; done; echo $?",
    );
  });

  it("return after a failed command still reports that command", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(env, testDir, "f() { false; return; }; f; echo $?");
  });

  // --- the downstream set -e repro (ai-ecoverse/slicc#2978) ----------------

  it("set -e does not kill the shell after a break", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      "set -euo pipefail; while :; do [ 5 -eq 0 ] && break; break; done; echo ok",
    );
  });

  it("set -e does not kill the shell after a continue", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      "set -euo pipefail; for i in 1 2; do [ $i -eq 0 ] && continue; continue; done; echo ok",
    );
  });
});
