import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

/**
 * Under `set -u`, a word that is exactly one double-quoted part holding exactly
 * one `${var<op>word}` took a dedicated array-expansion path that probed the
 * variable with nounset still armed. Adjacent literal text ("${U:-d}b") took the
 * general path and already behaved, which made the failure look arbitrary.
 */
describe("nounset with a whole-word quoted default - GNU Bash Comparison", () => {
  let testDirectory: string;

  beforeEach(async () => {
    testDirectory = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDirectory);
  });

  it("uses the default for a whole-word quoted ${var:-word}", async () => {
    const env = await setupFiles(testDirectory, {});
    await compareOutputs(
      env,
      testDirectory,
      'set -u; unset JB_NOUNSET_A; echo "${JB_NOUNSET_A:-fallback}"',
    );
  });

  it("uses the default for a whole-word quoted ${var-word}", async () => {
    const env = await setupFiles(testDirectory, {});
    await compareOutputs(
      env,
      testDirectory,
      'set -u; unset JB_NOUNSET_B; echo "${JB_NOUNSET_B-fallback}"; echo "[${JB_NOUNSET_B-}]"',
    );
  });

  it("assigns and expands a whole-word quoted ${var:=word}", async () => {
    const env = await setupFiles(testDirectory, {});
    await compareOutputs(
      env,
      testDirectory,
      'set -u; unset JB_NOUNSET_C; echo "${JB_NOUNSET_C:=assigned}"; echo "$JB_NOUNSET_C"',
    );
  });

  it("assigns and expands a whole-word quoted ${var=word}", async () => {
    const env = await setupFiles(testDirectory, {});
    await compareOutputs(
      env,
      testDirectory,
      'set -u; unset JB_NOUNSET_D; echo "${JB_NOUNSET_D=assigned}"; echo "$JB_NOUNSET_D"',
    );
  });

  it("yields nothing for a whole-word quoted ${var:+word}", async () => {
    const env = await setupFiles(testDirectory, {});
    await compareOutputs(
      env,
      testDirectory,
      'set -u; unset JB_NOUNSET_E; echo "[${JB_NOUNSET_E:+alt}]"',
    );
  });

  it("yields nothing for a whole-word quoted ${var+word}", async () => {
    const env = await setupFiles(testDirectory, {});
    await compareOutputs(
      env,
      testDirectory,
      'set -u; unset JB_NOUNSET_F; echo "[${JB_NOUNSET_F+alt}]"',
    );
  });

  it("keeps honouring set values and the empty/unset distinction", async () => {
    const env = await setupFiles(testDirectory, {});
    await compareOutputs(
      env,
      testDirectory,
      'set -u; JB_NOUNSET_G=value; JB_NOUNSET_H=; echo "${JB_NOUNSET_G:-fallback}"; echo "[${JB_NOUNSET_H:-fallback}]"; echo "[${JB_NOUNSET_H-fallback}]"',
    );
  });

  it("runs the GitHub Actions summary guard both ways", async () => {
    const env = await setupFiles(testDirectory, {});
    await compareOutputs(
      env,
      testDirectory,
      [
        "set -euo pipefail",
        "unset GITHUB_STEP_SUMMARY",
        'if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then echo "writing to $GITHUB_STEP_SUMMARY"; else echo "no step summary"; fi',
        "GITHUB_STEP_SUMMARY=summary.md",
        'if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then echo "report" >> "$GITHUB_STEP_SUMMARY"; fi',
        "cat summary.md",
      ].join("\n"),
    );
  });

  // `${#var}` and a bare `${var}` must still abort the script: no operator
  // suppresses nounset there, so nothing is printed and `echo reached` never
  // runs. Exit codes are excluded because bash -c reports an expansion error
  // as 127 while just-bash reports 1 -- an unrelated pre-existing difference;
  // src/interpreter/expansion/nounset-quoted-default.test.ts pins just-bash's
  // own status and message exactly. Both fixtures are locked to their Linux
  // (bash 5) diagnostic, which inserts "line 1: " where macOS bash 3.2 does
  // not; the recorded stderr is never compared, only kept from drifting.
  const stdoutOnly = { compareExitCode: false };

  it("still reports an unbound variable for a whole-word quoted ${#var}", async () => {
    const env = await setupFiles(testDirectory, {});
    await compareOutputs(
      env,
      testDirectory,
      'set -u; unset JB_NOUNSET_I; echo "${#JB_NOUNSET_I}"; echo reached',
      stdoutOnly,
    );
  });

  it("still reports an unbound variable for a whole-word quoted ${var}", async () => {
    const env = await setupFiles(testDirectory, {});
    await compareOutputs(
      env,
      testDirectory,
      'set -u; unset JB_NOUNSET_J; echo "${JB_NOUNSET_J}"; echo reached',
      stdoutOnly,
    );
  });

  it("uses the default for a whole-word quoted array default", async () => {
    const env = await setupFiles(testDirectory, {});
    await compareOutputs(
      env,
      testDirectory,
      'set -u; unset JB_NOUNSET_ARR; echo "${JB_NOUNSET_ARR[@]:-fallback}"; echo "[${JB_NOUNSET_ARR[@]:+alt}]"',
    );
  });
});
